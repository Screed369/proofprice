// Statistics kit, part 2: defineStatsTableSource(config) -> a complete SourcePlugin for a table that a statistics office or regulator
// publishes (one official figure per item, area and period: average retail prices, average rents, average fuel prices ...).
//
// A source folder then holds a ~50-line config instead of 300+ lines of fetch/parse/answer/harvest code. The kit does, the same way
// for every source:
//   - one request per question (only the item and area asked, newest `lastN` periods), through the reader in ./readers.ts;
//   - the answer with buildStatisticAnswer: price_type official_statistic, sample_size null (no record count is published), the
//     reference period, the change on a year earlier and on the previous period, the last 13 periods, the item's exact definition;
//   - harvest(): one request a day for every mapped item and area, the newest period only, n: NO_COUNT (never a made-up count),
//     rows dated by the end of the reference period (referenceDates), so stale-if-error and /history work with no extra code;
//   - safety checks that refuse to answer rather than answer wrongly: the publisher's own label must still contain the item's
//     pack size (labelMustContain), every value must sit inside the item's plausible band, and only listed items/areas exist.
//
// What a config MUST carry (the type requires it and kitProblems() in this file, run by tests/kits.test.ts, enforces it):
// licence + attribution (SourceInfo), a licenceCheck read on a stated date with a quote, at least one GOLDEN value copied by hand
// from the publisher's own web page (checked against a fixture of the live reply by the source's own test via checkKitFixture), and
// a plausible band per item.
//
// Owner: the Adapter Steward (Simon's OK, 22 Oct 2026). Source builders never edit this folder: they write a "Kit request" line on
// the Notion Gap fixes page. Any change to how figures are read or answered bumps KIT_VERSION (it is part of every kit source's
// method_version, so answer ids change honestly).

import type { ZodTypeAny } from "zod";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../answer";
import { InputError, SourceError } from "../../http";
import type { Example, HarvestResult, PageSpec, Params, SourceInfo, SourcePlugin } from "../../plugin";
import { NO_COUNT } from "../../stats";
import { matchItem, normaliseWords, exampleWords, ItemDef } from "../../../categories/groceries/items";
import { buildRequest, CUBE_KINDS, defaultFetcher, KitFetcher, KitRow, KitTable, parseReply, ReaderConfig, rowsFromRecords, Selection } from "./readers";
import { monthsSince, normalisePeriod, periodBounds, periodWords, previousOf, yearEarlier } from "./periods";

/** Bump when the kit changes how any figure is read, checked or answered. */
export const KIT_VERSION = "1";
export const KIT_NAME = "stats-table";

// ---------- config ----------

export interface KitItem {
  /** The publisher's code for the item (dimension category code, or the column name in a wide row table). */
  code: string;
  /** Our plain definition shown in answers, e.g. "Milk, 2.5% fat, 1 litre". */
  label: string;
  /** The unit the figure is for, e.g. "per litre", "per kg", "per 10 eggs", "per month". */
  unit: string;
  /** Everyday words for it (any case). The first item that lists a word is the default for that word. */
  words: string[];
  /** Text the publisher's own label for this code must contain (case and accents ignored), e.g. "1 l" or "10 pcs". Catches a code
   *  that now means another pack size. Required whenever the reader's format carries labels (cube readers). */
  labelMustContain?: string;
  /** [lowest, highest] believable value in the table's currency and this unit. A value outside is never answered. */
  plausible: [number, number];
}

export interface KitArea {
  /** The publisher's area code, or null when the table has no area dimension (one national figure). */
  code: string | null;
  /** ISO 3166-1 alpha-2 country this area belongs to. */
  iso: string;
  /** Plain name, e.g. "Latvia" or "Oslo and Bærum". */
  label: string;
  /** Other words people use for it. */
  words?: string[];
}

export interface LicenceCheck {
  /** YYYY-MM-DD the licence page was read. */
  checked: string;
  /** Short quote from the licence page. */
  quote: string;
  /** The licence page read (https). */
  url: string;
  /** May we use it commercially? "no" never builds; "unclear" builds only with a Decision id. */
  commercial: "yes" | "no" | "unclear";
  /** Notion "Simon is needed" decision id/title that allows an unclear or restricted licence. */
  decision?: string;
}

/** A figure copied BY HAND from the publisher's own web page (not from the API), to prove the mapping reads the right cell. */
export interface GoldenValue {
  /** Key in `items`. */
  item: string;
  /** Key in `areas` (default: the national area "ALL", else the first area). */
  area?: string;
  /** Kit period, e.g. "2026-09". */
  period: string;
  value: number;
  /** The publisher's page where a person can read the same figure (https). */
  seenAt: string;
  /** YYYY-MM-DD it was copied. */
  seenOn: string;
}

export interface StatsTableConfig {
  info: SourceInfo & { price_type: "official_statistic" };
  licenceCheck: LicenceCheck;
  /** The publisher's table or dataset id and title, e.g. { id: "PCC010m", title: "Average retail prices of selected goods" }. */
  table: { id: string; title: string };
  category: string;
  countryHelp: string;
  placeName: string;
  status?: "live" | "beta";
  reader: ReaderConfig;
  /** Dimension ids (cube readers) or column names (row readers). Leave out `item` for a wide row table (one column per item);
   *  leave out `area` when the table has one national figure. */
  dims: { time: string; item?: string; area?: string };
  /** Other dimensions pinned to one code, e.g. { ContentsCode: "PCC010m" } or { unit: "EUR" }. */
  fixed?: Record<string, string>;
  /** Row readers, long layout: the column holding the figure (e.g. "OBS_VALUE" is used automatically for sdmx-csv). */
  valueColumn?: string;
  /** Library item key -> item. Keys: lower-case words with dashes, e.g. "milk-1l". */
  items: Record<string, KitItem>;
  /** The request parameter that names the item: "item" (groceries), "fuel", "energy" ... */
  itemParam: string;
  /** Item key used when the request does not name one (e.g. rent tables with one measure). */
  defaultItem?: string;
  /** Library area key -> area. Use "ALL" for the national figure. */
  areas: Record<string, KitArea>;
  /** The request parameter that names a place, e.g. "region" or "town". Leave out for national-only tables. */
  areaParam?: string;
  currency: string;
  measure: "average" | "median";
  /** Newest periods asked per question (default 13: the latest, a year earlier and the months between). */
  lastN?: number;
  golden: GoldenValue[];
  /** One sentence: what a figure is, e.g. "Average shelf price recorded by CSB price collectors for the CPI; not a receipt." */
  whatThisIs: string;
  method: string;
  examples: Example[];
  pages?: PageSpec[];
  paramNotes?: Record<string, string>;
  paramValues?: Record<string, string[]>;
  extraParams?: Record<string, ZodTypeAny>;
  /** The publisher advises against comparing periods (fresh sample each year): no change figures in answers. */
  noChanges?: boolean;
  serves?(params: Params): boolean;
}

// The registry stays untouched: the kit remembers which plugins it built, so tests/kits.test.ts can find them in SOURCE_PLUGINS.
const BUILT = new WeakMap<SourcePlugin, StatsTableConfig>();
/** The kit config behind a registered source, or undefined for a hand-built source. */
export const kitConfigOf = (s: SourcePlugin): StatsTableConfig | undefined => BUILT.get(s);

// ---------- matching ----------

const itemDefs = (cfg: StatsTableConfig): ItemDef[] => Object.entries(cfg.items).map(([key, it]) => ({ code: key, label: it.label, unit: it.unit, words: it.words }));

export function nationalAreaKey(cfg: StatsTableConfig): string {
  return "ALL" in cfg.areas ? "ALL" : Object.keys(cfg.areas)[0];
}

/** Item key for a request, or null (no such item). */
export function resolveItem(cfg: StatsTableConfig, raw: string | undefined): { key: string | null; related: string[] } {
  const words = (raw ?? "").trim();
  if (!words) return { key: cfg.defaultItem ?? null, related: [] };
  if (cfg.items[words]) return { key: words, related: [] };
  const m = matchItem(itemDefs(cfg), words);
  return { key: m.primary?.code ?? null, related: m.related.map((d) => d.code) };
}

/** Area key for a request. No place given -> the national area. A place we do not have -> InputError naming the places we do have. */
export function resolveArea(cfg: StatsTableConfig, raw: string | undefined, country?: string): string {
  const q = normaliseWords(raw ?? "");
  const national = nationalAreaKey(cfg);
  if (!q) {
    if (country) {
      const own = Object.entries(cfg.areas).filter(([, a]) => a.iso === country);
      if (own.length && !own.some(([k]) => k === national)) return own[0][0];
    }
    return national;
  }
  for (const [key, a] of Object.entries(cfg.areas)) {
    if (country && a.iso !== country) continue;
    const names = [key, a.label, a.code ?? "", ...(a.words ?? [])].map(normaliseWords);
    if (names.includes(q)) return key;
  }
  if (country && cfg.areas[national]?.iso === country && normaliseWords(cfg.areas[national].label) === q) return national;
  const list = Object.values(cfg.areas).filter((a) => !country || a.iso === country).map((a) => a.label);
  throw new InputError(`'${raw}' is not a place in ${cfg.info.publisher} table ${cfg.table.id}. Use one of: ${list.join(", ")}${list.length > 1 ? "" : " (national figures only)"}.`);
}

// ---------- reading cells ----------

export interface CellSeries {
  areaKey: string;
  itemKey: string;
  /** Oldest first. */
  points: { period: string; value: number }[];
  /** The publisher's label for the item code, when the format carries one. */
  publisherLabel: string | null;
}

export interface ReadResult {
  cells: CellSeries[];
  title: string | null;
  updated: string | null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Turn a parsed reply into one series per (area, item). Pure; throws SourceError when a label check fails. */
export function cellsFromReply(cfg: StatsTableConfig, reply: ReturnType<typeof parseReply>, want: { items: string[]; areas: string[] }): ReadResult {
  const wideDim = "__item";
  const itemDim = cfg.dims.item ?? wideDim;
  let rows: KitRow[];
  let labels: KitTable["labels"] = {};
  let title: string | null = null;
  let updated: string | null = null;
  if ("cube" in reply) {
    rows = reply.cube.rows;
    labels = reply.cube.labels;
    title = reply.cube.title;
    updated = reply.cube.updated;
  } else {
    rows = cfg.dims.item
      ? rowsFromRecords(reply.records, { valueColumn: cfg.valueColumn ?? "value" })
      : rowsFromRecords(reply.records, { wideItemColumns: want.items.map((k) => cfg.items[k].code), itemDim: wideDim });
  }
  const byItemCode = new Map(want.items.map((k) => [cfg.items[k].code, k]));
  const byAreaCode = new Map(want.areas.map((k) => [cfg.areas[k].code, k]));
  const fixed = Object.entries(cfg.fixed ?? {});
  const series = new Map<string, CellSeries>();
  for (const r of rows) {
    if (r.value === null || !Number.isFinite(r.value)) continue;
    if (fixed.some(([d, code]) => r[d] !== undefined && String(r[d]) !== code)) continue;
    const itemKey = byItemCode.get(String(r[itemDim]));
    if (!itemKey) continue;
    const areaKey = cfg.dims.area ? byAreaCode.get(String(r[cfg.dims.area])) : want.areas[0];
    if (!areaKey) continue;
    const period = normalisePeriod(r[cfg.dims.time] as string);
    if (!period) continue;
    const id = `${areaKey}\u0000${itemKey}`;
    let s = series.get(id);
    if (!s) {
      const code = cfg.items[itemKey].code;
      s = { areaKey, itemKey, points: [], publisherLabel: labels[itemDim]?.[code] ?? null };
      series.set(id, s);
    }
    s.points.push({ period, value: r.value });
  }
  for (const s of series.values()) {
    s.points.sort((a, b) => a.period.localeCompare(b.period));
    s.points = s.points.filter((p, i, all) => i === all.length - 1 || all[i + 1].period !== p.period);
    const must = cfg.items[s.itemKey].labelMustContain;
    if (must && s.publisherLabel !== null && !fold(s.publisherLabel).includes(fold(must))) {
      throw new SourceError(
        `${cfg.info.publisher} now labels code ${cfg.items[s.itemKey].code} "${s.publisherLabel}", which no longer says "${must}". ` +
          `This source needs checking before it answers again (table ${cfg.table.id}).`,
      );
    }
  }
  return { cells: [...series.values()], title, updated };
}

export interface KitIo {
  fetcher?: KitFetcher;
  timeoutMs?: number;
}

/** One request for the given items and areas, newest `lastN` periods. */
export async function readCells(cfg: StatsTableConfig, want: { items: string[]; areas: string[] }, io: KitIo = {}): Promise<ReadResult> {
  const dims: Record<string, string[]> = {};
  if (cfg.dims.item) dims[cfg.dims.item] = want.items.map((k) => cfg.items[k].code);
  if (cfg.dims.area) dims[cfg.dims.area] = want.areas.map((k) => cfg.areas[k].code).filter((c): c is string => c !== null);
  for (const [d, code] of Object.entries(cfg.fixed ?? {})) dims[d] = [code];
  const sel: Selection = { dims, time: cfg.dims.time, lastN: cfg.lastN ?? 13 };
  const req = buildRequest(cfg.reader, sel);
  const body = await (io.fetcher ?? defaultFetcher(io.timeoutMs))(req);
  return cellsFromReply(cfg, parseReply(cfg.reader, body), want);
}

// ---------- the answer ----------

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function change(from: { period: string; value: number } | undefined, to: { period: string; value: number }) {
  if (!from || !(from.value > 0)) return null;
  return { reference_period: from.period, value: from.value, change_percent: round(((to.value - from.value) / from.value) * 100, 1), change_amount: round(to.value - from.value, 3) };
}

export interface KitQuery {
  params: Params;
  baseUrl?: string;
  today?: Date;
}

/** Build the answer for one series (pure). `series` null = the table has no figure for this item and area. */
export function kitAnswer(cfg: StatsTableConfig, itemKey: string, areaKey: string, series: CellSeries | null, read: Pick<ReadResult, "title" | "updated">, q: KitQuery, related: string[] = []): PriceAnswer {
  const item = cfg.items[itemKey];
  const area = cfg.areas[areaKey];
  const query: Record<string, unknown> = { country: area.iso, [cfg.itemParam]: q.params[cfg.itemParam] ?? itemKey };
  if (cfg.areaParam && q.params[cfg.areaParam] !== undefined) query[cfg.areaParam] = q.params[cfg.areaParam];
  const base = { source: cfg.info, query, measure: cfg.measure, currency: cfg.currency, unit: item.unit, method: cfg.method, baseUrl: q.baseUrl };
  const latest = series?.points[series.points.length - 1];
  if (!series || !latest) {
    return buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
  }
  const [lo, hi] = item.plausible;
  if (!(latest.value >= lo && latest.value <= hi)) {
    throw new SourceError(
      `${cfg.info.publisher} table ${cfg.table.id} gives ${latest.value} ${cfg.currency} for "${item.label}" in ${periodWords(latest.period)}, outside the believable range ${lo}-${hi}. ` +
        "Held back until the mapping is checked.",
    );
  }
  const today = q.today ?? new Date();
  const at = (p: string | null) => (p ? series.points.find((x) => x.period === p) : undefined);
  const yoy = cfg.noChanges ? null : change(at(yearEarlier(latest.period)), latest);
  const prev = cfg.noChanges ? null : change(at(previousOf(latest.period)), latest);
  const behind = monthsSince(latest.period, today);
  const notes: string[] = [];
  if (behind >= 6) notes.push(`Old data: the newest figure ${cfg.info.publisher} holds for this item is for ${periodWords(latest.period)}.`);
  const money = (v: number) => fmtMoney(v, cfg.currency);
  return buildStatisticAnswer({
    ...base,
    value: latest.value,
    period: periodBounds(latest.period) ?? { from: null, to: null },
    reference_period: latest.period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${area.label} the ${cfg.measure} price of "${item.label}" was ${money(v)} (${item.unit}) in ${periodWords(latest.period)}.` +
      (yoy ? ` That is ${yoy.change_percent === 0 ? "unchanged from" : `${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than`} a year earlier (${money(yoy.value)}).` : ""),
    extra: {
      area: { name: area.label, publisher_code: area.code },
      item: { key: itemKey, definition: item.label, unit: item.unit, publisher_code: item.code, publisher_label: series.publisherLabel, asked_for: q.params[cfg.itemParam] ?? null },
      what_this_is: cfg.whatThisIs,
      reference_period: latest.period,
      reference_period_label: periodWords(latest.period),
      change_on_year_earlier: yoy,
      change_on_previous_period: prev,
      recent_periods: series.points.slice(-13),
      other_definitions: related.filter((k) => k !== itemKey).map((k) => ({ item: cfg.items[k].words[0] ?? k, definition: cfg.items[k].label, unit: cfg.items[k].unit })),
      dataset: { id: cfg.table.id, title: read.title ?? cfg.table.title, updated: read.updated, url: cfg.info.homepage },
    },
  });
}

/** Answer one request (network through io.fetcher). */
export async function runStatsTable(cfg: StatsTableConfig, params: Params, ctx: { baseUrl?: string } = {}, io: KitIo = {}): Promise<PriceAnswer> {
  const asked = params[cfg.itemParam] === undefined || params[cfg.itemParam] === null ? undefined : String(params[cfg.itemParam]);
  const { key, related } = resolveItem(cfg, asked);
  const country = typeof params.country === "string" ? params.country.toUpperCase() : undefined;
  const areaKey = resolveArea(cfg, cfg.areaParam ? (params[cfg.areaParam] as string | undefined) : undefined, country);
  if (!key) {
    const hint = asked ? `${cfg.info.publisher} table ${cfg.table.id} has no standard item for "${asked}".` : `${cfg.itemParam} is required.`;
    throw new InputError(`${hint} Try one of: ${exampleWords(itemDefs(cfg), 30).join(", ")}.`);
  }
  const read = await readCells(cfg, { items: [key], areas: [areaKey] }, io);
  const series = read.cells.find((c) => c.itemKey === key && c.areaKey === areaKey) ?? null;
  return kitAnswer(cfg, key, areaKey, series, read, { params, baseUrl: ctx.baseUrl }, related);
}

// ---------- harvest ----------

/** Pure: library rows for the newest period any (area, item) has; values outside their band are left out and named in the note. */
export function harvestRows(cfg: StatsTableConfig, read: ReadResult): HarvestResult {
  const latestOf = (c: CellSeries) => c.points[c.points.length - 1];
  const withData = read.cells.filter((c) => c.points.length);
  if (!withData.length) throw new SourceError(`${cfg.info.publisher} table ${cfg.table.id} returned no figure for any mapped item`);
  const newest = withData.map((c) => latestOf(c).period).sort().pop()!;
  const held: string[] = [];
  const rows = withData
    .filter((c) => latestOf(c).period === newest)
    .filter((c) => {
      const v = latestOf(c).value;
      const [lo, hi] = cfg.items[c.itemKey].plausible;
      const ok = v >= lo && v <= hi;
      if (!ok) held.push(`${c.itemKey}/${c.areaKey}=${v}`);
      return ok;
    })
    .map((c) => {
      const v = latestOf(c).value;
      return { area: c.areaKey, item: c.itemKey, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  const units = new Set(Object.values(cfg.items).map((i) => i.unit));
  return {
    date: periodBounds(newest)!.to,
    currency: cfg.currency,
    unit: units.size === 1 ? [...units][0] : "per item (see the item's definition)",
    rows,
    note:
      `${cfg.info.publisher}, table ${cfg.table.id}: published ${cfg.measure}s for ${periodWords(newest)} (one figure per item and area; no record count is published).` +
      (held.length ? ` Held back by the believable-range check: ${held.join(", ")}.` : ""),
  };
}

export async function harvestStatsTable(cfg: StatsTableConfig, io: KitIo = {}): Promise<HarvestResult> {
  const read = await readCells(cfg, { items: Object.keys(cfg.items), areas: Object.keys(cfg.areas) }, { ...io, timeoutMs: io.timeoutMs ?? 60000 });
  return harvestRows(cfg, read);
}

// ---------- the plugin ----------

export function defineStatsTableSource(cfg: StatsTableConfig): SourcePlugin {
  const countries = [...new Set(Object.values(cfg.areas).map((a) => a.iso))];
  const info: SourceInfo = { ...cfg.info, method_version: `${KIT_NAME}-${KIT_VERSION}${cfg.info.method_version ? `/${cfg.info.method_version}` : ""}` };
  const cfgWithInfo: StatsTableConfig = { ...cfg, info: info as StatsTableConfig["info"] };
  const plugin: SourcePlugin = {
    info,
    category: cfg.category,
    countries,
    countryHelp: cfg.countryHelp,
    placeName: cfg.placeName,
    status: cfg.status ?? "live",
    paramNotes: cfg.paramNotes,
    paramValues: cfg.paramValues,
    extraParams: cfg.extraParams,
    examples: cfg.examples,
    pages: cfg.pages,
    method: cfg.method,
    serves: cfg.serves,
    handle: (p, ctx) => runStatsTable(cfgWithInfo, p, ctx),
    harvest: () => harvestStatsTable(cfgWithInfo),
    historyKey: (p) => {
      const asked = p[cfg.itemParam] === undefined ? undefined : String(p[cfg.itemParam]);
      const item = resolveItem(cfg, asked).key;
      if (!item) return null;
      let area: string;
      try {
        area = resolveArea(cfg, cfg.areaParam ? (p[cfg.areaParam] as string | undefined) : undefined, typeof p.country === "string" ? p.country.toUpperCase() : undefined);
      } catch {
        return null;
      }
      return { area, item, label: `${cfg.items[item].label}, ${cfg.areas[area].label}` };
    },
    referenceDates: true,
    nominalCounts: true,
  };
  BUILT.set(plugin, cfgWithInfo);
  return plugin;
}

// ---------- the gate (pure; run by tests/kits.test.ts for every kit source) ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Licence words that block a build unless a Decision allows it (research page "Licence traps", 22 Oct 2026). */
export const RESTRICTED_TERMS = /OPEN-BY-ASK|\bBY-NC\b|non-?commercial|\bBY-ND\b|no derivatives|share-?alike|\bBY-SA\b|\bODbL\b|permission required/i;

export function kitProblems(cfg: StatsTableConfig, today: Date = new Date()): string[] {
  const p: string[] = [];
  const where = `sources/${cfg.info.id} (stats-table kit)`;
  const bad = (m: string) => p.push(`${where}: ${m}`);
  if (cfg.info.price_type !== "official_statistic") bad(`info.price_type must be "official_statistic" (the kit passes on published figures)`);
  const lc = cfg.licenceCheck;
  if (!lc) bad("licenceCheck is missing: read the licence page and fill { checked, quote, url, commercial }");
  else {
    if (!ISO_DATE.test(lc.checked) || lc.checked > today.toISOString().slice(0, 10)) bad(`licenceCheck.checked must be the YYYY-MM-DD you read the licence page (got "${lc.checked}")`);
    if (!lc.quote || lc.quote.trim().length < 10) bad("licenceCheck.quote must quote the licence page (10+ characters)");
    if (!/^https:\/\//.test(lc.url ?? "")) bad("licenceCheck.url must be the https licence page you read");
    if (!["yes", "no", "unclear"].includes(lc.commercial)) bad(`licenceCheck.commercial must be "yes", "no" or "unclear"`);
    if (lc.commercial === "no") bad("licenceCheck.commercial is \"no\": this table may not be used; do not build it");
    if (lc.commercial === "unclear" && !lc.decision) bad("licenceCheck.commercial is \"unclear\": build only with a 'Simon is needed' decision named in licenceCheck.decision");
    if (RESTRICTED_TERMS.test(`${cfg.info.licence} ${lc.quote}`) && !lc.decision) bad(`the licence has restricted terms (${RESTRICTED_TERMS.exec(`${cfg.info.licence} ${lc.quote}`)?.[0]}): build only with a decision in licenceCheck.decision`);
  }
  if (!cfg.info.attribution.includes(cfg.table.id)) bad(`info.attribution must name the table id "${cfg.table.id}" so every figure is traceable`);
  if (!cfg.info.attribution.toLowerCase().includes(cfg.info.publisher.split(/[ (,]/)[0].toLowerCase())) bad("info.attribution must name the publisher");
  const itemKeys = Object.keys(cfg.items);
  if (!itemKeys.length) bad("items is empty: list each item explicitly (no 'all items')");
  const usedCodes = new Set<string>();
  for (const [k, it] of Object.entries(cfg.items)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(k)) bad(`item key "${k}" must be lower-case words with dashes`);
    if (usedCodes.has(it.code)) bad(`item code ${it.code} is mapped twice`);
    usedCodes.add(it.code);
    if (!it.unit?.trim() || !it.label?.trim()) bad(`item ${k}: label and unit are required`);
    if (!Array.isArray(it.plausible) || it.plausible.length !== 2 || !(it.plausible[0] > 0) || !(it.plausible[1] > it.plausible[0])) bad(`item ${k}: plausible must be [low, high] with 0 < low < high`);
    else if (it.plausible[1] / it.plausible[0] > 50) bad(`item ${k}: plausible band ${it.plausible} is too wide to catch a unit mistake (max ratio 50)`);
    if (CUBE_KINDS.has(cfg.reader.kind) && !it.labelMustContain) bad(`item ${k}: labelMustContain is required for a ${cfg.reader.kind} table (the publisher's label must keep naming the pack size)`);
  }
  if (cfg.defaultItem && !cfg.items[cfg.defaultItem]) bad(`defaultItem "${cfg.defaultItem}" is not in items`);
  const areaKeys = Object.keys(cfg.areas);
  if (!areaKeys.length) bad("areas is empty");
  for (const [k, a] of Object.entries(cfg.areas)) {
    if (!/^[A-Z]{2}$/.test(a.iso)) bad(`area ${k}: iso must be an ISO 3166 alpha-2 code`);
    if (a.code === null && cfg.dims.area) bad(`area ${k}: code is null but the table has an area dimension (${cfg.dims.area})`);
    if (a.code !== null && !cfg.dims.area) bad(`area ${k}: code "${a.code}" given but dims.area is not set`);
  }
  if (!cfg.dims.area && areaKeys.length !== 1) bad("a table without an area dimension has exactly one area");
  if (!cfg.dims.item && CUBE_KINDS.has(cfg.reader.kind)) bad("dims.item is required for a cube table");
  if (!cfg.dims.item && !cfg.valueColumn && !CUBE_KINDS.has(cfg.reader.kind)) {
    /* wide row table: item codes are column names; nothing else to check */
  }
  if (cfg.dims.item && !CUBE_KINDS.has(cfg.reader.kind) && cfg.reader.kind !== "sdmx-csv" && !cfg.valueColumn) bad("valueColumn is required for a long row table");
  for (const iso of new Set(Object.values(cfg.areas).map((a) => a.iso))) if (!new RegExp(`\\b${iso}\\b`).test(cfg.countryHelp)) bad(`countryHelp should mention ${iso}`);
  if (!cfg.golden?.length) bad("golden is empty: copy at least one figure by hand from the publisher's own web page");
  for (const g of cfg.golden ?? []) {
    if (!cfg.items[g.item]) bad(`golden item "${g.item}" is not in items`);
    if (g.area !== undefined && !cfg.areas[g.area]) bad(`golden area "${g.area}" is not in areas`);
    if (!periodBounds(g.period)) bad(`golden period "${g.period}" must be a kit period such as 2026-09 or 2026-Q3`);
    if (!/^https:\/\//.test(g.seenAt) || /proofprice/i.test(g.seenAt)) bad("golden.seenAt must be the publisher's own https page");
    if (!ISO_DATE.test(g.seenOn)) bad("golden.seenOn must be YYYY-MM-DD");
    if (!(g.value > 0)) bad("golden.value must be the figure as printed (above 0)");
  }
  if (cfg.examples?.length) {
    const ex = cfg.examples[0].params;
    if (!ex[cfg.itemParam] && !cfg.defaultItem) bad(`the first example must name ${cfg.itemParam}`);
  }
  return p;
}

/**
 * The fixture check every kit source runs in its own source.test.ts: parse a reply copied from the live service with the source's
 * own reader and config, then (1) every golden value must be the figure in that cell, (2) every mapped item and area that the
 * fixture holds passes its label check and believable range. Returns problems (empty = pass).
 */
export function checkKitFixture(cfg: StatsTableConfig, body: unknown): string[] {
  const p: string[] = [];
  let read: ReadResult;
  try {
    read = cellsFromReply(cfg, parseReply(cfg.reader, body), { items: Object.keys(cfg.items), areas: Object.keys(cfg.areas) });
  } catch (e: any) {
    return [`fixture does not parse with this config: ${e?.message ?? e}`];
  }
  if (!read.cells.length) p.push("the fixture holds no cell for any mapped item and area (wrong codes or dimension names?)");
  for (const c of read.cells) {
    const [lo, hi] = cfg.items[c.itemKey].plausible;
    for (const pt of c.points) if (!(pt.value >= lo && pt.value <= hi)) p.push(`${c.itemKey}/${c.areaKey} ${pt.period} = ${pt.value} is outside plausible [${lo}, ${hi}]`);
  }
  for (const g of cfg.golden) {
    const area = g.area ?? nationalAreaKey(cfg);
    const cell = read.cells.find((c) => c.itemKey === g.item && c.areaKey === area);
    const got = cell?.points.find((x) => x.period === g.period)?.value;
    if (got === undefined) p.push(`golden ${g.item}/${area} ${g.period}: the fixture has no such cell (put the golden month inside the fixture)`);
    else if (Math.abs(got - g.value) > 0.0005 * Math.max(1, Math.abs(g.value))) p.push(`golden ${g.item}/${area} ${g.period}: the publisher's page says ${g.value}, the table reads ${got} (wrong code, unit or dimension)`);
  }
  return p;
}
