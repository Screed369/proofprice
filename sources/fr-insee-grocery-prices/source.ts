// France: "Prix moyens de vente au détail" from INSEE's macro-economic database (BDM), the national average retail prices of a few dozen
// food items from the INSEE price survey (metropolitan France, euros, VAT included). One SDMX request returns many series:
//   GET https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/<IDBANK>+<IDBANK>+...?lastNObservations=14   (no key; XML, SDMX 2.1 structure-specific)
// Format checked on 2026-10-24 from GitHub's servers (probes inseem1 + inseea1; the workspace shell cannot reach insee.fr): each
// <Series IDBANK FREQ TITLE_FR TITLE_EN LAST_UPDATE UNIT_MEASURE="EUROS" REF_AREA="FM"> holds <Obs TIME_PERIOD OBS_VALUE OBS_STATUS .../>, newest
// first; FREQ M has TIME_PERIOD "YYYY-MM", FREQ A has "YYYY"; a missing value is OBS_VALUE="NaN" (OBS_STATUS "O"). Series come back in any order.
//
// INSEE publishes one national average per item and period: no distribution and no record count. So the answer is an official statistic
// (value + measure "average", no range, sample_size null). The collector (harvest) asks INSEE once a day and stores, for each monthly item,
// the newest month, the month before and the same month a year earlier, and for each annual item the newest two years. Requests are answered
// from that copy. INSEE's licence: free reuse including commercial, data unaltered, source and last-update date named.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "fr-insee-grocery-prices",
  country: "FR (France)",
  category: "groceries (national average retail prices of selected food items)",
  name: "Prix moyens de vente au détail (average retail prices of selected food items), INSEE",
  publisher: "INSEE (Institut national de la statistique et des études économiques)",
  what_is_recorded:
    "For a set of fresh food items (fruit, vegetables, meat, fish and shellfish), the national average retail price in euros per the unit stated (kg or dozen), " +
    "from INSEE's price survey in metropolitan France, as published in INSEE's macro-economic database. One published average per item and month (or year); never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly items in the middle of the following month, annual items in January; collected into our price library every day, each answer states its reference month or year and INSEE's last-update date",
  licence:
    "INSEE re-use conditions (https://www.insee.fr/fr/information/2381855, conditions 2.1 and 2.2): re-use of the data is free, including for commercial purposes, without licence or payment, provided the data are not altered and the source and the date of the last update are named.",
  licence_url: "https://www.insee.fr/fr/information/2381855",
  attribution:
    "Source: Insee, Prix moyens de vente au détail (macro-economic database BDM), data last updated by Insee on the date stated in the answer. " +
    "The published figures are passed on unchanged; the percentage changes are calculated by ProofPrice. Insee has not reviewed this work.",
  homepage: "https://www.insee.fr/fr/plan-du-site/famille-bdm/103157792",
  limits:
    "National averages for metropolitan France only (no regional or city prices), for INSEE's standard items and pack sizes; INSEE gives no count of prices behind an average. " +
    "These are average shelf prices observed for price statistics, not receipts, and not the price at any one shop or online. A few INSEE series are discontinued or have gaps; we skip those.",
};

// ---------- the items: everyday words -> INSEE series (IDBANK) ----------
// Labels are INSEE's own English series titles (read 2026-10-24). The first definition that lists a word is the default for it.
export type Freq = "M" | "A";
export interface FrItem extends ItemDef {
  freq: Freq;
}
export const ITEMS: FrItem[] = [
  { code: "000641367", freq: "M", label: "Apples (1 kg)", unit: "per kg", words: ["apples", "apple", "pommes", "pomme"] },
  { code: "000641360", freq: "M", label: "Ware potatoes (1 kg)", unit: "per kg", words: ["potatoes", "potato", "pommes de terre", "pomme de terre", "ware potatoes"] },
  { code: "000641430", freq: "M", label: "New potatoes (1 kg)", unit: "per kg", words: ["new potatoes", "pommes de terre nouvelles"] },
  { code: "000641422", freq: "M", label: "Carrots (1 kg)", unit: "per kg", words: ["carrots", "carrot", "carottes", "carotte"] },
  { code: "000442435", freq: "M", label: "Beef: T-bone steak (entrecôte) (1 kg)", unit: "per kg", words: ["beef", "steak", "beef steak", "t-bone steak", "entrecote", "boeuf", "bœuf"] },
  { code: "000641405", freq: "M", label: "Monkfish (lotte), in slices (1 kg)", unit: "per kg", words: ["monkfish", "lotte", "baudroie"] },
  { code: "000641413", freq: "M", label: "Sole (1 kg)", unit: "per kg", words: ["sole", "fish"] },
  { code: "000641417", freq: "M", label: "Shrimps (1 kg)", unit: "per kg", words: ["shrimps", "shrimp", "prawns", "prawn", "crevettes", "crevette"] },
  { code: "000442624", freq: "A", label: "Beef: fillet (1 kg)", unit: "per kg", words: ["beef fillet", "fillet steak", "filet de boeuf", "filet"] },
  { code: "000442626", freq: "A", label: "Beef: rump (1 kg)", unit: "per kg", words: ["beef rump", "rump steak", "rumsteck", "rumsteak"] },
  { code: "000442640", freq: "A", label: "Pig: fillet roast (1 kg)", unit: "per kg", words: ["pork", "pork roast", "pork fillet", "rôti de porc", "roti de porc", "porc"] },
  { code: "000442645", freq: "A", label: "Whole rabbit (1 kg)", unit: "per kg", words: ["rabbit", "whole rabbit", "lapin"] },
  { code: "000641376", freq: "A", label: "Medium-caliber cupped oysters (per dozen)", unit: "per dozen", words: ["oysters", "oyster", "huitres", "huitre"] },
  { code: "000641469", freq: "A", label: "Lemons (1 kg)", unit: "per kg", words: ["lemons", "lemon", "citrons", "citron"] },
  { code: "000641386", freq: "A", label: "Oranges (1 kg)", unit: "per kg", words: ["oranges", "orange"] },
  { code: "000641380", freq: "A", label: "Green beans (1 kg)", unit: "per kg", words: ["green beans", "green bean", "haricots verts", "beans"] },
];
const BY_CODE = new Map(ITEMS.map((i) => [i.code, i]));

export const SDMX_BASE = "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/";
export const SERIES_URL = `${SDMX_BASE}${ITEMS.map((i) => i.code).join("+")}?lastNObservations=14`;

// ---------- reading the file (pure) ----------

export interface SeriesPoint {
  /** "2026-09" (monthly) or "2025" (annual) */
  period: string;
  value: number;
}
export interface Series {
  idbank: string;
  freq: Freq;
  title: string;
  /** INSEE's LAST_UPDATE, "YYYY-MM-DD" */
  lastUpdate: string;
  /** Valid points only (NaN gaps dropped), oldest first. */
  points: SeriesPoint[];
}

const attr = (s: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(s);
  return m ? m[1] : null;
};

/** Every euro-priced series we list, by IDBANK. Throws if the answer is not the SDMX message we expect. */
export function parseSdmx(xml: string): Map<string, Series> {
  if (!/<message:StructureSpecificData/.test(xml) || !/<Series\s/.test(xml)) throw new SourceError("The INSEE BDM answer is not the SDMX data message we expect: no <Series> found.");
  const out = new Map<string, Series>();
  const re = /<Series\s([^>]*)>([\s\S]*?)<\/Series>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const head = m[1];
    const id = attr(head, "IDBANK");
    const freq = attr(head, "FREQ");
    if (!id || !BY_CODE.has(id) || (freq !== "M" && freq !== "A")) continue;
    if (attr(head, "UNIT_MEASURE") !== "EUROS") continue;
    const points: SeriesPoint[] = [];
    const obs = /<Obs\s([^>]*)\/>/g;
    let o: RegExpExecArray | null;
    while ((o = obs.exec(m[2]))) {
      const period = attr(o[1], "TIME_PERIOD");
      const value = Number(attr(o[1], "OBS_VALUE"));
      const okPeriod = period !== null && (freq === "M" ? /^\d{4}-\d{2}$/.test(period) : /^\d{4}$/.test(period));
      if (okPeriod && Number.isFinite(value) && value > 0) points.push({ period: period as string, value });
    }
    points.sort((a, b) => a.period.localeCompare(b.period));
    out.set(id, { idbank: id, freq, title: attr(head, "TITLE_EN") ?? "", lastUpdate: attr(head, "LAST_UPDATE") ?? "", points });
  }
  return out;
}

export function shiftMonth(month: string, delta: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1) : 0;
}

// ---------- the collector ----------

const ROW_PREV = ".m1";
const ROW_YEAR = ".y1";
const ROW_UPDATE = "_last_update";
/** Annual items are stored as `<IDBANK>.A<year>` for the newest two years. */
const annualRow = (code: string, year: number) => `${code}.A${year}`;

const row = (item: string, v: number): DailyRow => ({ area: "ALL", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
const yyyymmdd = (d: string) => Number(d.replace(/-/g, ""));

const at = (s: Series | undefined, period: string) => s?.points.find((p) => p.period === period)?.value;

/** The newest month over the monthly series we list. */
export function newestMonth(series: Map<string, Series>): string | null {
  let best: string | null = null;
  for (const s of series.values()) {
    if (s.freq !== "M") continue;
    const p = s.points[s.points.length - 1]?.period;
    if (p && (!best || p > best)) best = p;
  }
  return best;
}

/**
 * Pure: library rows for the newest month. Monthly item: the figure (item = IDBANK), the month before (.m1) and the same month a year earlier (.y1),
 * only for series priced in the newest month. Annual item: the newest two years (`.A<year>`), only if the newest year is at most two years old
 * (discontinued series such as common dabs, last priced 2021, are skipped). Each row is one published average: n is NO_COUNT, range fields repeat the figure.
 * One extra row `_last_update` holds INSEE's newest LAST_UPDATE as yyyymmdd, because the licence asks us to name it.
 */
export function harvestFromSeries(series: Map<string, Series>, today: Date = new Date()): HarvestResult {
  const month = newestMonth(series);
  if (!month) throw new SourceError("The INSEE BDM answer holds no usable monthly grocery price.");
  const prev = shiftMonth(month, -1)!;
  const year = shiftMonth(month, -12)!;
  const rows: DailyRow[] = [];
  let updated = "";
  for (const def of ITEMS) {
    const s = series.get(def.code);
    if (!s) continue;
    if (def.freq === "M") {
      const now = at(s, month);
      if (now === undefined) continue;
      rows.push(row(def.code, now));
      const p = at(s, prev);
      if (p !== undefined) rows.push(row(def.code + ROW_PREV, p));
      const y = at(s, year);
      if (y !== undefined) rows.push(row(def.code + ROW_YEAR, y));
    } else {
      const last = s.points[s.points.length - 1];
      if (!last || Number(last.period) < today.getUTCFullYear() - 2) continue;
      rows.push(row(annualRow(def.code, Number(last.period)), last.value));
      const before = at(s, String(Number(last.period) - 1));
      if (before !== undefined) rows.push(row(annualRow(def.code, Number(last.period) - 1), before));
    }
    if (s.lastUpdate > updated) updated = s.lastUpdate;
  }
  const monthly = rows.filter((r) => /^\d+$/.test(r.item)).length;
  if (monthly < 5) throw new SourceError(`Only ${monthly} monthly grocery rows found for ${month} in the INSEE answer; refusing to store it.`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) rows.push(row(ROW_UPDATE, yyyymmdd(updated)));
  return {
    date: `${month}-01`,
    currency: "EUR",
    unit: "per item as stated (see item.unit)",
    rows,
    note: `INSEE Prix moyens de vente au détail for ${monthWords(month)}, with the previous month and the same month a year earlier; annual items for their newest two years. Published averages, not counts of records (no record count is published).`,
  };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function download(url: string, timeoutMs: number): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/xml,*/*" }, signal: ctl.signal });
    if (!res.ok) throw new SourceError(`INSEE BDM answered HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function frHarvest(o: { today?: Date; load?: (url: string) => Promise<string> } = {}): Promise<HarvestResult> {
  const load = o.load ?? ((u: string) => download(u, 60000));
  return harvestFromSeries(parseSdmx(await load(SERIES_URL)), o.today);
}

// ---------- the library copy ----------

export interface FrFigure {
  freq: Freq;
  /** "2026-09" or "2025" */
  period: string;
  latest: number;
  /** the month before / the year before */
  previous: number | null;
  /** monthly items only: the same month a year earlier */
  yearAgo: number | null;
}
export interface Snapshot {
  date: string; // YYYY-MM-01 of the newest month
  month: string; // YYYY-MM
  lastUpdate: string | null; // INSEE's last-update date, YYYY-MM-DD
  figures: Map<string, FrFigure>;
}

export function snapshotFromRows(date: string, rows: LibraryRow[]): Snapshot {
  const raw = new Map<string, number>();
  for (const r of rows) if (r.area === "ALL") raw.set(r.item, r.median);
  const figures = new Map<string, FrFigure>();
  const month = date.slice(0, 7);
  for (const def of ITEMS) {
    if (def.freq === "M") {
      const v = raw.get(def.code);
      if (v === undefined) continue;
      figures.set(def.code, { freq: "M", period: month, latest: v, previous: raw.get(def.code + ROW_PREV) ?? null, yearAgo: raw.get(def.code + ROW_YEAR) ?? null });
    } else {
      const years = [...raw.keys()]
        .map((k) => new RegExp(`^${def.code}\\.A(\\d{4})$`).exec(k))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => Number(m[1]))
        .sort((a, b) => b - a);
      if (!years.length) continue;
      figures.set(def.code, { freq: "A", period: String(years[0]), latest: raw.get(annualRow(def.code, years[0]))!, previous: raw.get(annualRow(def.code, years[0] - 1)) ?? null, yearAgo: null });
    }
  }
  const u = raw.get(ROW_UPDATE);
  const s = u ? String(Math.round(u)) : "";
  return { date, month, lastUpdate: /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null, figures };
}

let cache: { key: string; snap: Snapshot } | null = null;
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta || !day) return null;
  const key = `${day.date}:${day.rows.length}:${meta.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const snap = snapshotFromRows(day.date, day.rows);
  cache = { key, snap };
  return snap;
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const eur = (v: number) => `€${v.toFixed(2)}`;

export function change(from: number | null, to: number): { change_percent: number; change_amount: number } | null {
  if (from === null || !(from > 0)) return null;
  return { change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: roundTo(to - from, 3) };
}

const FR_WORDS = new Set(["fr", "france", "fra", "national", "nationwide", "all", "whole country", "metropolitan france", "metropole", "métropole"]);

export function frMethod(): string {
  return (
    "INSEE publishes, in its macro-economic database, the national average retail price of selected food items from its price survey in metropolitan France (euros, VAT included), monthly for some items and yearly for others. " +
    "ProofPrice collects the newest figures once a day and returns the published average unchanged, with the previous period and (for monthly items) the same month a year earlier, and the changes we calculate from them. " +
    "No range is calculated: INSEE gives one average and no count of prices behind it. These are averages compiled for price statistics, not receipts."
  );
}

export interface FrQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function frAnswer(snap: Snapshot, def: FrItem | null, related: FrItem[], q: FrQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "FR", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: frMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !FR_WORDS.has(q.region.trim().toLowerCase())
      ? `INSEE publishes these averages for metropolitan France only, so the region "${q.region}" was ignored and the figure is the national average.`
      : undefined;
  const fig = def ? snap.figures.get(def.code) : undefined;

  if (!def || !fig) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `INSEE's latest figures hold no price for "${def.label}".` : `INSEE's average retail prices list has no standard item for "${q.item}".`;
    const available = ITEMS.filter((d) => snap.figures.has(d.code));
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(available, 24).join(", ")}.`,
      extra: { available_items: exampleWords(available, 80), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const monthly = fig.freq === "M";
  const when = monthly ? monthWords(fig.period) : fig.period;
  const [y, m] = monthly ? fig.period.split("-").map(Number) : [Number(fig.period), 12];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const period = monthly ? { from: `${fig.period}-01`, to: `${fig.period}-${String(lastDay).padStart(2, "0")}` } : { from: `${fig.period}-01-01`, to: `${fig.period}-12-31` };
  const today = q.today ?? new Date();
  const behind = monthly ? monthsBehind(fig.period, today) : (today.getUTCFullYear() - Number(fig.period)) * 12;
  const yoy = monthly ? change(fig.yearAgo, fig.latest) : change(fig.previous, fig.latest);
  const yoyBase = monthly ? fig.yearAgo : fig.previous;
  const yoyPeriod = monthly ? shiftMonth(fig.period, -12)! : String(Number(fig.period) - 1);
  const mom = monthly ? change(fig.previous, fig.latest) : null;
  const notes: string[] = [];
  if (monthly ? behind >= 4 : behind >= 30) notes.push(`Old data: the newest INSEE figure we hold is for ${when}.`);
  if (regionNote) notes.push(regionNote);
  if (snap.lastUpdate) notes.push(`INSEE last updated the data on ${snap.lastUpdate}.`);

  const extra: Record<string, unknown> = {
    country_name: "France",
    item: { code: def.code, definition: def.label, unit: def.unit, asked_for: q.item },
    what_this_is: "National average retail price from INSEE's price survey in metropolitan France, VAT included. Not a receipt and not the price at any one shop.",
    frequency: monthly ? "monthly" : "annual",
    reference_period_label: when,
    ...(monthly ? { reference_month: fig.period } : { reference_year: fig.period }),
    insee_last_update: snap.lastUpdate,
    change_on_year_earlier: yoy && yoyBase !== null ? { reference_period: yoyPeriod, value: yoyBase, ...yoy } : null,
    ...(monthly ? { change_on_previous_month: mom && fig.previous !== null ? { reference_month: shiftMonth(fig.period, -1), value: fig.previous, ...mom } : null } : {}),
    other_definitions: related.filter((d) => snap.figures.has(d.code)).map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    library_snapshot_date: snap.date,
    dataset: { title: "Prix moyens de vente au détail (INSEE BDM)", url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: fig.latest,
    unit: def.unit,
    period,
    reference_period: fig.period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In France the national average retail price of "${def.label}" was ${eur(v)} in ${when} (INSEE price survey, metropolitan France, not receipts).` +
      (yoy && yoyBase !== null
        ? yoy.change_percent === 0
          ? ` That is unchanged from ${monthly ? monthWords(yoyPeriod) : yoyPeriod} (${eur(yoyBase)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than ${monthly ? "a year earlier" : "the year before"} (${eur(yoyBase)} in ${monthly ? monthWords(yoyPeriod) : yoyPeriod}).`
        : monthly
          ? " No price for the same month a year earlier is available."
          : " No price for the year before is available."),
    extra,
  });
}

// ---------- the request ----------

export async function frGroceryPrices(input: FrQuery, o: { snapshot?: Snapshot | null } = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'apples', 'carrots' or 'shrimps'.");
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("ProofPrice collects INSEE's average retail prices daily; data appears after the next collection.");
  const m = matchItem(ITEMS, item);
  return frAnswer(snap, (m.primary as FrItem | null) ?? null, m.related as FrItem[], input);
}

/** Where a request lives in the library, without asking INSEE. Annual items have no daily series, so no history key. */
export function frHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const m = p.item ? (matchItem(ITEMS, p.item).primary as FrItem | null) : null;
  return m && m.freq === "M" ? { area: "ALL", item: m.code, label: m.label } : null;
}
