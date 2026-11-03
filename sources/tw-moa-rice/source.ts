// Taiwan: national average daily grain (rice) prices, Agriculture and Food Agency (AFA), Ministry of Agriculture (MOA).
// Dataset "National average daily grain price" (data.gov.tw/en/datasets/87817), open API, no key. Format checked live on 2026-11-03
// (GET from the cloud workspace, 200): a JSON array, newest day first, one object per day since 1989 (9,458 days), dates in the
// Republic of China (Minguo) calendar "1151103" = 2026-11-03. Fields (catalogue descriptions read 2026-11-03):
//   pt_1*  retail price of white rice, NT$ per kg      pt_2*  wholesale price of white rice, NT$ per 100 kg
//   pt_4*  paddy (unhusked rice) price, NT$ per 100 kg
//   japt = japonica, tsait = hard indica, sangt = soft indica, glutrt = round glutinous, glutlt = long glutinous.
// The API takes $top=N (newest N days), so a question downloads about 200 KB, never the 4.9 MB history. 0 means "no price that day".
//
// The MOA publishes ONE national average per variety and day and no record count, so the answer is an official statistic
// (buildStatisticAnswer, sample_size null, range fields null). The retail figure changes only about every third day.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "tw-moa-rice",
  country: "TW (Taiwan)",
  category: "groceries (rice: retail, wholesale and paddy prices)",
  name: "National average daily grain price, Agriculture and Food Agency, Ministry of Agriculture (Taiwan)",
  publisher: "Agriculture and Food Agency (AFA), Ministry of Agriculture (MOA), Taiwan",
  what_is_recorded:
    "For each day, one national average price per rice variety (japonica, hard indica, soft indica, round and long glutinous): the retail price of white rice in NT$ per kg, " +
    "the wholesale price in NT$ per 100 kg and the paddy (unhusked rice) price in NT$ per 100 kg. One published figure per variety and day; never an individual shop or sale.",
  price_type: "official_statistic",
  freshness: "Daily (the retail figure changes about every third day); each answer states its date",
  licence: "Open Government Data License, version 1.0 (Taiwan): free reuse, including commercial use, with attribution",
  licence_url: "https://data.gov.tw/license",
  attribution:
    "Source: Agriculture and Food Agency, Ministry of Agriculture, Taiwan: 'National average daily grain price' (https://data.gov.tw/en/datasets/87817), " +
    "Open Government Data License v1.0. Figures are passed on as published; the changes on earlier dates are calculated by ProofPrice.",
  homepage: "https://data.gov.tw/en/datasets/87817",
  limits:
    "National averages for rice only (no other grains, no regions), one figure per variety and day with no record count. The publisher does not describe its survey method in the dataset, " +
    "and the retail figure moves only about every third day. These are statistics, not receipts, and not the price in any one shop. Wholesale and paddy prices are per 100 kg, retail per kg.",
};

export const API = "https://data.moa.gov.tw/Service/OpenData/Ricepriceavg.aspx?IsTransData=1&UnitId=E69";
/** Newest days asked for: 400 covers the same day a year earlier with room to spare. */
export const DAYS_ASKED = 400;
const HEADERS = { accept: "application/json", "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" };

// ---------- the items: everyday words -> published fields ----------

export type Stage = "retail" | "wholesale" | "paddy";
export interface RiceItem extends ItemDef {
  stage: Stage;
}

const mk = (code: string, stage: Stage, label: string, words: string[]): RiceItem => ({
  code,
  stage,
  label,
  unit: stage === "retail" ? "per kg" : "per 100 kg",
  words,
});

/** The first definition that lists a word is the default for it, so "rice" is the retail price of japonica white rice (Taiwan's staple). */
export const ITEMS: RiceItem[] = [
  mk("pt_1japt_price", "retail", "Retail price of japonica white rice, per kg", ["rice", "white rice", "japonica rice", "japonica white rice", "japonica", "taiwan rice", "retail rice"]),
  mk("pt_1tsait_price", "retail", "Retail price of hard indica white rice, per kg", ["indica rice", "hard indica rice", "indica", "hard indica", "indica white rice"]),
  mk("pt_1sangt_price", "retail", "Retail price of soft indica white rice, per kg", ["soft indica rice", "soft indica"]),
  mk("pt_1glutrt_price", "retail", "Retail price of round glutinous white rice, per kg", ["glutinous rice", "sticky rice", "round glutinous rice", "sweet rice", "glutinous"]),
  mk("pt_1glutlt_price", "retail", "Retail price of long glutinous white rice, per kg", ["long glutinous rice", "long sticky rice"]),
  mk("pt_2japt_price", "wholesale", "Wholesale price of japonica white rice, per 100 kg", ["wholesale rice", "wholesale japonica rice", "wholesale white rice"]),
  mk("pt_2tsait_price", "wholesale", "Wholesale price of hard indica white rice, per 100 kg", ["wholesale indica rice", "wholesale hard indica rice"]),
  mk("pt_2sangt_price", "wholesale", "Wholesale price of soft indica white rice, per 100 kg", ["wholesale soft indica rice"]),
  mk("pt_2glutrt_price", "wholesale", "Wholesale price of round glutinous white rice, per 100 kg", ["wholesale glutinous rice", "wholesale round glutinous rice", "wholesale sticky rice"]),
  mk("pt_2glutlt_price", "wholesale", "Wholesale price of long glutinous white rice, per 100 kg", ["wholesale long glutinous rice"]),
  mk("pt_4japt_price", "paddy", "Paddy (unhusked japonica rice) price, per 100 kg", ["paddy", "paddy rice", "paddy price", "unhusked rice", "rough rice", "japonica paddy"]),
  mk("pt_4tsait_price", "paddy", "Paddy (unhusked hard indica rice) price, per 100 kg", ["indica paddy", "hard indica paddy"]),
  mk("pt_4sangt_price", "paddy", "Paddy (unhusked soft indica rice) price, per 100 kg", ["soft indica paddy"]),
  mk("pt_4glutrt_price", "paddy", "Paddy (unhusked round glutinous rice) price, per 100 kg", ["glutinous paddy", "round glutinous paddy", "sticky rice paddy"]),
  mk("pt_4glutlt_price", "paddy", "Paddy (unhusked long glutinous rice) price, per 100 kg", ["long glutinous paddy"]),
];

// ---------- reading the file (pure) ----------

export interface Day {
  /** ISO date, e.g. "2026-11-03" */
  date: string;
  /** field -> NT$ (only positive, finite figures; a 0 means no price that day) */
  values: Record<string, number>;
}

/** Minguo "1151103" (or "0781201") -> "2026-11-03"; null when the text is not a real date. */
export function minguoToIso(text: string): string | null {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The days of the response, newest first. A changed layout (not an array, no known field) is a SourceError, never a silent empty answer. */
export function parseDays(json: unknown): Day[] {
  if (!Array.isArray(json)) throw new SourceError("The Taiwan grain price file has changed shape: expected a list of days.");
  const fields = ITEMS.map((i) => i.code);
  const days: Day[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const date = typeof r.pt_date === "string" ? minguoToIso(r.pt_date) : null;
    if (!date) continue;
    const values: Record<string, number> = {};
    for (const f of fields) {
      const v = Number(r[f]);
      if (Number.isFinite(v) && v > 0) values[f] = v;
    }
    days.push({ date, values });
  }
  if (json.length > 0 && !days.some((d) => Object.keys(d.values).length > 0)) {
    throw new SourceError("The Taiwan grain price file has changed shape: no dated day with a known price field was found.");
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

export const addDays = (iso: string, delta: number): string => new Date(Date.parse(iso + "T00:00:00Z") + delta * 86400000).toISOString().slice(0, 10);

/** The same calendar day `months` earlier (clamped to the month's end), e.g. 2026-03-31 minus 1 month = 2026-02-28. */
export function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = idx % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export interface Reading {
  field: string;
  latest: { date: string; value: number };
  /** value on (or within 7 days before) the same day a month / a year earlier */
  monthAgo: { date: string; value: number } | null;
  yearAgo: { date: string; value: number } | null;
  /** the newest figure of each of the last 13 calendar months, oldest first */
  monthly: { month: string; date: string; value: number }[];
  newestDayInFile: string;
}

/** Newest day (at or before `onOrBefore`, within 7 days) holding a price for the field. */
function near(days: Day[], field: string, target: string): { date: string; value: number } | null {
  const floor = addDays(target, -7);
  for (const d of days) {
    if (d.date > target) continue;
    if (d.date < floor) return null;
    const v = d.values[field];
    if (v !== undefined) return { date: d.date, value: v };
  }
  return null;
}

export function readField(days: Day[], field: string): Reading | null {
  const first = days.find((d) => d.values[field] !== undefined);
  if (!first) return null;
  const latest = { date: first.date, value: first.values[field] };
  const monthly: Reading["monthly"] = [];
  const seen = new Set<string>();
  for (const d of days) {
    const v = d.values[field];
    if (v === undefined || d.date > latest.date) continue;
    const month = d.date.slice(0, 7);
    if (seen.has(month)) continue;
    seen.add(month);
    monthly.push({ month, date: d.date, value: v });
    if (monthly.length >= 13) break;
  }
  return {
    field,
    latest,
    monthAgo: near(days, field, shiftMonths(latest.date, -1)),
    yearAgo: near(days, field, shiftMonths(latest.date, -12)),
    monthly: monthly.reverse(),
    newestDayInFile: days[0]?.date ?? latest.date,
  };
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const nt = (v: number) => `NT$${Number.isInteger(v) ? v : v.toFixed(2)}`;

export function change(from: { date: string; value: number } | null, to: number) {
  if (!from || !(from.value > 0)) return null;
  return { reference_date: from.date, value: from.value, change_percent: roundTo(((to - from.value) / from.value) * 100, 1), change_amount: roundTo(to - from.value, 3) };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-03" -> "3 November 2026" */
export function dateWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : iso;
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

const TAIWAN_WORDS = new Set(["tw", "taiwan", "twn", "national", "nationwide", "all", "whole country", "roc", "republic of china"]);

export function riceMethod(): string {
  return (
    "The Agriculture and Food Agency of Taiwan's Ministry of Agriculture publishes, for every day, one national average price per rice variety: retail (NT$ per kg), wholesale (NT$ per 100 kg) and paddy (NT$ per 100 kg). " +
    "ProofPrice returns the newest published figure unchanged, with the figure about a month and a year earlier, the changes we calculate from them and the last 13 months. " +
    "No range is calculated: the publisher gives one average and no count of prices behind it. These are statistics, not receipts."
  );
}

export interface RiceQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function riceAnswer(reading: Reading | null, def: RiceItem | null, related: ItemDef[], q: RiceQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "TW", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "TWD", method: riceMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !TAIWAN_WORDS.has(q.region.trim().toLowerCase())
      ? `The Ministry of Agriculture publishes this as a national average only, so the region "${q.region}" was ignored and the figure is for the whole of Taiwan.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `The Taiwan grain price file holds no price for "${def.label}" in the last ${DAYS_ASKED} days.`
      : `The Taiwan grain price file covers rice only and has no item for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const today = (q.today ?? new Date()).toISOString().slice(0, 10);
  const age = daysBetween(reading.latest.date, today);
  const mom = change(reading.monthAgo, reading.latest.value);
  const yoy = change(reading.yearAgo, reading.latest.value);
  const notes: string[] = [];
  if (age > 14) notes.push(`Old data: the newest price in the Ministry's file for this item is from ${dateWords(reading.latest.date)}, ${age} days ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Taiwan",
    item: { field: def.code, definition: def.label, stage: def.stage, unit: def.unit, asked_for: q.item },
    what_this_is:
      "National average rice price published by the Agriculture and Food Agency, Ministry of Agriculture (Taiwan). One figure per variety and day; not a receipt and not the price at any one shop.",
    reference_date: reading.latest.date,
    reference_date_label: dateWords(reading.latest.date),
    ...(def.stage !== "retail" ? { per_kg_equivalent: roundTo(reading.latest.value / 100, 3) } : {}),
    change_on_month_earlier: mom,
    change_on_year_earlier: yoy,
    last_13_months: reading.monthly.map((m) => ({ month: m.month, date: m.date, value: m.value })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    dataset: { title: "National average daily grain price", url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: reading.latest.value,
    unit: def.unit,
    period: { from: reading.latest.date, to: reading.latest.date },
    reference_period: reading.latest.date,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Taiwan the published national average for "${def.label.replace(/, per .*$/, "")}" was ${nt(v)} ${def.unit} on ${dateWords(reading.latest.date)} ` +
      `(Ministry of Agriculture grain price statistics, not receipts).` +
      (yoy
        ? yoy.change_percent === 0
          ? ` That is unchanged from a year earlier (${nt(yoy.value)} on ${dateWords(yoy.reference_date)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${nt(yoy.value)} on ${dateWords(yoy.reference_date)}).`
        : " No price for about a year earlier is available."),
    extra,
  });
}

// ---------- the request ----------

export async function fetchDays(o: { load?: (url: string) => Promise<unknown>; top?: number } = {}): Promise<Day[]> {
  const url = `${API}&$top=${o.top ?? DAYS_ASKED}`;
  const load = o.load ?? ((u: string) => fetchJson(u, { headers: HEADERS }, 20000));
  return parseDays(await retryOnce(() => load(url)));
}

export async function twRicePrices(input: RiceQuery, o: { load?: (url: string) => Promise<unknown> } = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: for Taiwan use rice, for example 'rice', 'glutinous rice', 'wholesale rice' or 'paddy'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return riceAnswer(null, null, [], input);
  const days = await fetchDays({ load: o.load });
  return riceAnswer(readField(days, m.primary.code), m.primary as RiceItem, m.related, input);
}

// ---------- the collector ----------

const row = (item: string, v: number): DailyRow => ({ area: "ALL", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });

/** Pure: one library row per item for the newest day that holds any price. Each row is one published figure (n is NO_COUNT). */
export function harvestFromDays(days: Day[]): HarvestResult {
  const newest = days.find((d) => Object.keys(d.values).length > 0);
  if (!newest) throw new SourceError("The Taiwan grain price file holds no usable price.");
  const rows: DailyRow[] = [];
  for (const it of ITEMS) {
    const r = readField(days, it.code);
    // the date of the library row is the newest day with ANY price; an item whose own latest day is older is skipped (never copied forward)
    if (r && r.latest.date === newest.date) rows.push(row(it.code, r.latest.value));
  }
  if (rows.length < 10) throw new SourceError(`Only ${rows.length} of ${ITEMS.length} Taiwan rice prices found for ${newest.date}; refusing to store them.`);
  return {
    date: newest.date,
    currency: "TWD",
    unit: "retail per kg; wholesale and paddy per 100 kg (see item)",
    rows,
    note: `Agriculture and Food Agency, Taiwan: national average daily rice prices for ${newest.date}. Published averages, not counts of records (no record count is published).`,
  };
}

export async function twHarvest(o: { load?: (url: string) => Promise<unknown> } = {}): Promise<HarvestResult> {
  return harvestFromDays(await fetchDays({ load: o.load, top: 45 }));
}

/** Where a request lives in the library, without asking the Ministry. */
export function twHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const m = p.item ? matchItem(ITEMS, p.item).primary : null;
  return m ? { area: "ALL", item: m.code, label: m.label } : null;
}
