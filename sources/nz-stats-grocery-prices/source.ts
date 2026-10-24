// New Zealand: "Selected price indexes" from Stats NZ, the monthly weighted average prices of 74 food and drink items (series CPIM.SAPnnnn,
// units "Dollars"), published as one CSV per release. Format checked on 2026-10-24 by downloading the September 2026 file from GitHub's
// servers (the workspace shell cannot reach stats.govt.nz): header Series_reference,Period,Data_value,STATUS,UNITS,Subject,Group,
// Series_title_1..3; Period is "YYYY.MM"; the grocery series have Group "Food Price Index Selected Monthly Weighted Average Prices for New Zealand".
//
// Stats NZ publishes one national average per item and month: no distribution and no record count. So the answer is an official statistic
// (value + measure "average", no range, sample_size null). The collector (harvest) downloads the newest file once a day and stores, for each
// item, the latest month, the month before and the same month a year earlier; requests are answered from that copy.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "nz-stats-grocery-prices",
  country: "NZ (New Zealand)",
  category: "groceries (monthly weighted average prices of selected food items)",
  name: "Selected price indexes (Food Price Index selected monthly weighted average prices), Stats NZ",
  publisher: "Stats NZ (Tatauranga Aotearoa)",
  what_is_recorded:
    "For 74 food and drink items, the national monthly weighted average price in New Zealand dollars per the unit stated (kg, litre, dozen or pack), as published by Stats NZ with its monthly Selected price indexes release. " +
    "One published average per item and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, in the middle of the following month; collected into our price library every day, each answer states its reference month",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0). Stats NZ's copyright page states: \"Unless otherwise specified, content we produce is licensed under the Creative Commons Attribution 4.0 International licence.\"",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Stats NZ, Selected price indexes, licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/). " +
    "This work is based on Stats NZ's data. ProofPrice selects the items and calculates the changes; Stats NZ has not reviewed it.",
  homepage: "https://www.stats.govt.nz/information-releases/selected-price-indexes-september-2026/",
  limits:
    "National averages only (no regional prices), for Stats NZ's 74 standard items and pack sizes; Stats NZ's file gives no count of prices behind an average. " +
    "These are weighted average prices compiled for price statistics, not receipts, and not the price at any one shop or online. Some items change definition or are dropped between releases.",
};

// ---------- the items: everyday words -> Stats NZ series (CPIM.SAPnnnn) ----------
// Labels are Stats NZ's own series titles (read 2026-10-24). The first definition that lists a word is the default for it.
export const ITEMS: ItemDef[] = [
  { code: "SAP0100", label: "Oranges, 1kg", unit: "per 1kg", words: ["oranges", "orange"] },
  { code: "SAP0101", label: "Bananas, 1kg", unit: "per 1kg", words: ["bananas", "banana"] },
  { code: "SAP0102", label: "Apples, 1kg", unit: "per 1kg", words: ["apples", "apple"] },
  { code: "SAP0103", label: "Kiwifruit, 1kg", unit: "per 1kg", words: ["kiwifruit", "kiwi fruit", "kiwi"] },
  { code: "SAP0106", label: "Lettuce, 1kg", unit: "per 1kg", words: ["lettuce"] },
  { code: "SAP0107", label: "Broccoli, 1kg", unit: "per 1kg", words: ["broccoli"] },
  { code: "SAP0108", label: "Cabbage, 1kg", unit: "per 1kg", words: ["cabbage"] },
  { code: "SAP0109", label: "Tomatoes, 1kg", unit: "per 1kg", words: ["tomatoes", "tomato"] },
  { code: "SAP0110", label: "Carrots, 1kg", unit: "per 1kg", words: ["carrots", "carrot"] },
  { code: "SAP0111", label: "Mushrooms, 1kg", unit: "per 1kg", words: ["mushrooms", "mushroom"] },
  { code: "SAP0112", label: "Potatoes, 1kg", unit: "per 1kg", words: ["potatoes", "potato"] },
  { code: "SAP0114", label: "Beef steak - blade, 1kg", unit: "per 1kg", words: ["beef steak blade", "blade steak", "beef steak", "steak"] },
  { code: "SAP0115", label: "Beef steak - porterhouse/sirloin, 1kg", unit: "per 1kg", words: ["beef steak porterhouse", "sirloin steak", "porterhouse steak", "porterhouse", "sirloin"] },
  { code: "SAP0116", label: "Beef - mince, 1kg", unit: "per 1kg", words: ["beef mince", "mince", "minced beef", "ground beef", "beef"] },
  { code: "SAP0117", label: "Pork - loin chops, 1kg", unit: "per 1kg", words: ["pork loin chops", "pork chops", "pork"] },
  { code: "SAP0118", label: "Lamb - chops, 1kg", unit: "per 1kg", words: ["lamb chops", "lamb"] },
  { code: "SAP0120", label: "Sausages, 1kg", unit: "per 1kg", words: ["sausages", "sausage"] },
  { code: "SAP0121", label: "Tuna - canned (supermarket only), 185g", unit: "per 185g", words: ["canned tuna", "tuna"] },
  { code: "SAP0123", label: "Biscuits - chocolate, 200g", unit: "per 200g", words: ["chocolate biscuits", "biscuits"] },
  { code: "SAP0125", label: "Flour - white (supermarket only), 1.5kg", unit: "per 1.5kg", words: ["white flour", "flour"] },
  { code: "SAP0126", label: "Rice - long grain, white (supermarket only), 1kg", unit: "per 1kg", words: ["rice", "white rice", "long grain rice"] },
  { code: "SAP0127", label: "Milk - standard homogenised, 2 litres", unit: "per 2 litres", words: ["milk", "standard milk", "whole milk", "full-fat milk", "homogenised milk"] },
  { code: "SAP0128", label: "Yoghurt - flavoured, 150g pottle (supermarket only), pk of 6", unit: "per pack of 6 pottles (150 g each)", words: ["flavoured yoghurt", "yoghurt", "yogurt"] },
  { code: "SAP0129", label: "Cheese - mild cheddar (supermarket only), 1kg", unit: "per 1kg", words: ["cheese", "cheddar", "cheddar cheese", "mild cheddar"] },
  { code: "SAP0130", label: "Eggs, dozen", unit: "per dozen", words: ["eggs", "egg", "dozen eggs"] },
  { code: "SAP0131", label: "Butter - salted, 500g", unit: "per 500g", words: ["butter", "salted butter"] },
  { code: "SAP0132", label: "Sugar - white, 1.5kg", unit: "per 1.5kg", words: ["sugar", "white sugar"] },
  { code: "SAP0134", label: "Chocolate - block (supermarket only), 250g", unit: "per 250g", words: ["chocolate block", "chocolate", "block of chocolate"] },
  { code: "SAP0137", label: "Coffee - instant, 100g", unit: "per 100g", words: ["instant coffee", "coffee"] },
  { code: "SAP0138", label: "Tea bags (supermarket only), box of 100", unit: "per box of 100", words: ["tea bags", "tea", "teabags"] },
  { code: "SAP0139", label: "Soft drink, 1.5 litres", unit: "per 1.5 litres", words: ["soft drink", "soft drinks", "fizzy drink", "cola"] },
  { code: "SAP0140", label: "Bottled water, 750ml", unit: "per 750ml", words: ["bottled water", "water"] },
  { code: "SAP0147", label: "Bacon - middle rashers (supermarket only), 700g", unit: "per 700g", words: ["bacon", "middle bacon", "bacon rashers"] },
  { code: "SAP0148", label: "Chicken breast, 1kg", unit: "per 1kg", words: ["chicken breast", "chicken"] },
  { code: "SAP0149", label: "Bread - white sliced loaf, 600g", unit: "per 600g", words: ["white bread", "bread", "sliced bread", "loaf of bread", "loaf"] },
  { code: "SAP0152", label: "Avocado, 1kg", unit: "per 1kg", words: ["avocado", "avocados"] },
  { code: "SAP0160", label: "Capsicums, green, else red, 1kg", unit: "per 1kg", words: ["capsicums", "capsicum", "bell pepper", "peppers"] },
  { code: "SAP0161", label: "Cauliflower, 1kg", unit: "per 1kg", words: ["cauliflower"] },
  { code: "SAP0167", label: "Chicken pieces (excluding breast), boneless or bone in, 1kg", unit: "per 1kg", words: ["chicken pieces", "chicken thighs", "chicken drumsticks"] },
  { code: "SAP0168", label: "Chicken, whole, frozen, No. 15 - Cheapest Available", unit: "per whole bird (size 15)", words: ["whole frozen chicken", "whole chicken", "frozen chicken"] },
  { code: "SAP0176", label: "Corn flakes, 500g", unit: "per 500g", words: ["corn flakes", "cornflakes", "cereal"] },
  { code: "SAP0177", label: "Corned beef, fresh, chilled or frozen, 1kg", unit: "per 1kg", words: ["corned beef"] },
  { code: "SAP0178", label: "Courgettes, 1kg", unit: "per 1kg", words: ["courgettes", "courgette", "zucchini"] },
  { code: "SAP0181", label: "Cucumber, 1kg", unit: "per 1kg", words: ["cucumber", "cucumbers"] },
  { code: "SAP0184", label: "Dried pasta, spaghetti or other type, 500g", unit: "per 500g", words: ["dried pasta", "pasta", "spaghetti"] },
  { code: "SAP0186", label: "Milk, calcium enriched, 2 litres", unit: "per 2 litres", words: ["calcium enriched milk", "trim milk"] },
  { code: "SAP0187", label: "Fish fillets, frozen, multipack, 500g", unit: "per 500g", words: ["frozen fish fillets", "fish fillets"] },
  { code: "SAP0189", label: "Eggs, free range, 6 pack", unit: "per 6-pack", words: ["free range eggs", "free-range eggs"] },
  { code: "SAP0190", label: "Fresh fish, 1kg", unit: "per 1kg", words: ["fresh fish", "fish"] },
  { code: "SAP0195", label: "Coffee, ground, 200g", unit: "per 200g", words: ["ground coffee", "coffee grounds"] },
  { code: "SAP0197", label: "Honey, clover, creamed, 500g", unit: "per 500g", words: ["honey"] },
  { code: "SAP0201", label: "Ice cream bought in bulk, 2 litres", unit: "per 2 litres", words: ["ice cream", "icecream"] },
  { code: "SAP0203", label: "Infant formula, 900g", unit: "per 900g", words: ["infant formula", "baby formula", "formula"] },
  { code: "SAP0204", label: "Jam, 375g", unit: "per 375g", words: ["jam"] },
  { code: "SAP0205", label: "Kumara, 1kg", unit: "per 1kg", words: ["kumara", "sweet potato"] },
  { code: "SAP0207", label: "Mandarins, 1kg", unit: "per 1kg", words: ["mandarins", "mandarin"] },
  { code: "SAP0211", label: "Muesli, natural or toasted, 750g", unit: "per 750g", words: ["muesli"] },
  { code: "SAP0215", label: "Olive oil, pure, not extra virgin or light, 1 litre", unit: "per 1 litre", words: ["olive oil"] },
  { code: "SAP0216", label: "Onions, 1kg", unit: "per 1kg", words: ["onions", "onion"] },
  { code: "SAP0224", label: "Pears, 1kg", unit: "per 1kg", words: ["pears", "pear"] },
  { code: "SAP0226", label: "Pineapple, 1kg", unit: "per 1kg", words: ["pineapple"] },
  { code: "SAP0228", label: "Potato fries, frozen, 1kg", unit: "per 1kg", words: ["frozen fries", "fries", "frozen chips"] },
  { code: "SAP0229", label: "Prawns, frozen, 700g", unit: "per 700g", words: ["frozen prawns", "prawns", "prawn"] },
  { code: "SAP0231", label: "Pumpkin, 1kg", unit: "per 1kg", words: ["pumpkin"] },
  { code: "SAP0232", label: "Roasting lamb and hogget, fresh, chilled or frozen, 1kg", unit: "per 1kg", words: ["roasting lamb", "leg of lamb", "lamb roast"] },
  { code: "SAP0233", label: "Roasting pork, fresh, chilled or frozen, 1kg", unit: "per 1kg", words: ["roasting pork", "pork roast"] },
  { code: "SAP0235", label: "Salami, 100g", unit: "per 100g", words: ["salami"] },
  { code: "SAP0240", label: "Soy milk, unflavoured, 1 litre", unit: "per 1 litre", words: ["soy milk", "soya milk"] },
  { code: "SAP0245", label: "Peanut butter, not salt free, 375g", unit: "per 375g", words: ["peanut butter"] },
  { code: "SAP0258", label: "Wheatmeal bread, sliced, 700g", unit: "per 700g", words: ["wheatmeal bread", "brown bread"] },
  { code: "SAP0259", label: "Wholegrain bread, sliced, 700g", unit: "per 700g", words: ["wholegrain bread", "wholemeal bread", "whole grain bread"] },
  { code: "SAP0264", label: "Margarine/table spread, 500g", unit: "per 500g", words: ["margarine", "table spread", "spread"] },
  { code: "SAP0265", label: "Mayonnaise, 380ml", unit: "per 380ml", words: ["mayonnaise", "mayo"] },
  { code: "SAP0268", label: "Ham, sliced or shaved, 1kg", unit: "per 1kg", words: ["ham", "sliced ham"] },
];

// ---------- reading the file (pure) ----------

export interface SeriesPoint {
  /** "2026-09" */
  month: string;
  value: number;
}

/** Minimal CSV line splitter for Stats NZ's quoted, comma-separated rows (a quoted field may hold commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const SERIES_RE = /^CPIM\.(SAP\d{4})$/;
const WANTED = new Set(ITEMS.map((i) => i.code));

/** Every dollar-priced Selected Monthly Weighted Average Price series we list, by code, oldest month first. Throws if the file has changed shape. */
export function parseSeries(csv: string): Map<string, SeriesPoint[]> {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const head = splitCsvLine(lines[0] ?? "");
  const col = (n: string) => head.indexOf(n);
  const [iRef, iPer, iVal, iUnit, iStatus] = ["Series_reference", "Period", "Data_value", "UNITS", "STATUS"].map(col);
  if ([iRef, iPer, iVal, iUnit].some((i) => i < 0)) throw new SourceError("The Stats NZ Selected price indexes file has changed shape: expected columns Series_reference, Period, Data_value, UNITS.");
  const out = new Map<string, SeriesPoint[]>();
  for (let n = 1; n < lines.length; n++) {
    if (!lines[n]) continue;
    const f = splitCsvLine(lines[n]);
    const m = SERIES_RE.exec(f[iRef] ?? "");
    if (!m || !WANTED.has(m[1]) || f[iUnit] !== "Dollars") continue;
    if (iStatus >= 0 && f[iStatus] && f[iStatus] !== "FINAL" && f[iStatus] !== "REVISED") continue;
    const p = /^(\d{4})\.(\d{2})$/.exec(f[iPer] ?? "");
    const value = Number(f[iVal]);
    if (!p || !Number.isFinite(value) || !(value > 0)) continue;
    const list = out.get(m[1]) ?? [];
    list.push({ month: `${p[1]}-${p[2]}`, value });
    out.set(m[1], list);
  }
  for (const l of out.values()) l.sort((a, b) => a.month.localeCompare(b.month));
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

/** The newest month in the file (over the series we list). */
export function newestMonth(series: Map<string, SeriesPoint[]>): string | null {
  let best: string | null = null;
  for (const l of series.values()) {
    const m = l[l.length - 1]?.month;
    if (m && (!best || m > best)) best = m;
  }
  return best;
}

const ROW_PREV = ".m1";
const ROW_YEAR = ".y1";

const row = (item: string, v: number): DailyRow => ({ area: "ALL", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });

/** Pure: library rows for the newest month. Per item: the figure (item = code), the month before (code.m1) and the same month a year earlier (code.y1),
 *  only for items priced in the newest month. Each row is one published average: n is NO_COUNT and the range fields repeat the figure. */
export function harvestFromSeries(series: Map<string, SeriesPoint[]>): HarvestResult {
  const month = newestMonth(series);
  if (!month) throw new SourceError("The Stats NZ Selected price indexes file holds no usable grocery price.");
  const prev = shiftMonth(month, -1)!;
  const year = shiftMonth(month, -12)!;
  const rows: DailyRow[] = [];
  for (const def of ITEMS) {
    const l = series.get(def.code);
    const at = (m: string) => l?.find((p) => p.month === m)?.value;
    const now = at(month);
    if (now === undefined) continue;
    rows.push(row(def.code, now));
    const p = at(prev);
    if (p !== undefined) rows.push(row(def.code + ROW_PREV, p));
    const y = at(year);
    if (y !== undefined) rows.push(row(def.code + ROW_YEAR, y));
  }
  if (rows.length < 20) throw new SourceError(`Only ${rows.length} grocery rows found for ${month} in the Stats NZ file; refusing to store it.`);
  return {
    date: `${month}-01`,
    currency: "NZD",
    unit: "per item as stated (see item.unit)",
    rows,
    note: `Stats NZ Selected price indexes, Food Price Index selected monthly weighted average prices for ${monthWords(month)}, with the previous month and the same month a year earlier. Published averages, not counts of records (no record count is published).`,
  };
}

const MONTH_LOWER = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** The release file URLs to try, newest first: this month's release, then the three before. */
export function candidateUrls(today: Date): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, 1));
    const name = MONTH_LOWER[d.getUTCMonth()];
    const cap = name[0].toUpperCase() + name.slice(1);
    const y = d.getUTCFullYear();
    out.push(`https://www.stats.govt.nz/assets/Uploads/Selected-price-indexes/Selected-price-indexes-${cap}-${y}/Download-data/selected-price-indexes-${name}-${y}.csv`);
  }
  return out;
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function download(url: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/csv,*/*" }, signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`Stats NZ answered HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function nzHarvest(o: { today?: Date; load?: (url: string) => Promise<string | null> } = {}): Promise<HarvestResult> {
  const load = o.load ?? ((u: string) => download(u, 60000));
  for (const url of candidateUrls(o.today ?? new Date())) {
    const text = await load(url);
    if (text) return harvestFromSeries(parseSeries(text));
  }
  throw new SourceError("No Selected price indexes file was found at Stats NZ for the last four months.");
}

// ---------- the library copy ----------

export interface NzFigure {
  latest: number;
  previous: number | null;
  yearAgo: number | null;
}
export interface Snapshot {
  date: string; // YYYY-MM-01 of the reference month
  month: string; // YYYY-MM
  figures: Map<string, NzFigure>;
}

export function snapshotFromRows(date: string, rows: LibraryRow[]): Snapshot {
  const raw = new Map<string, number>();
  for (const r of rows) if (r.area === "ALL") raw.set(r.item, r.median);
  const figures = new Map<string, NzFigure>();
  for (const def of ITEMS) {
    const v = raw.get(def.code);
    if (v === undefined) continue;
    figures.set(def.code, { latest: v, previous: raw.get(def.code + ROW_PREV) ?? null, yearAgo: raw.get(def.code + ROW_YEAR) ?? null });
  }
  return { date, month: date.slice(0, 7), figures };
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
const nzd = (v: number) => `NZ$${v.toFixed(2)}`;

export function change(from: number | null, to: number): { change_percent: number; change_amount: number } | null {
  if (from === null || !(from > 0)) return null;
  return { change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: roundTo(to - from, 3) };
}

const NZ_WORDS = new Set(["nz", "new zealand", "nzl", "national", "nationwide", "all", "whole country", "aotearoa"]);

export function nzMethod(): string {
  return (
    "Stats NZ publishes, with each monthly Selected price indexes release, the national monthly weighted average price of 74 food and drink items. " +
    "ProofPrice collects the newest release once a day and returns the published average for the latest month unchanged, with the previous month and the same month a year earlier, and the changes we calculate from them. " +
    "No range is calculated: Stats NZ gives one average and no count of prices behind it. These are averages compiled for price statistics, not receipts."
  );
}

export interface NzQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function nzAnswer(snap: Snapshot, def: ItemDef | null, related: ItemDef[], q: NzQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "NZ", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "NZD", method: nzMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !NZ_WORDS.has(q.region.trim().toLowerCase())
      ? `Stats NZ publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of New Zealand.`
      : undefined;
  const fig = def ? snap.figures.get(def.code) : undefined;

  if (!def || !fig) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `Stats NZ's latest release holds no price for "${def.label}" in ${monthWords(snap.month)}.` : `Stats NZ's selected-prices list has no standard item for "${q.item}".`;
    const available = ITEMS.filter((d) => snap.figures.has(d.code));
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(available, 24).join(", ")}.`,
      extra: { available_items: exampleWords(available, 80), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const month = snap.month;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const behind = monthsBehind(month, q.today ?? new Date());
  const yoy = change(fig.yearAgo, fig.latest);
  const mom = change(fig.previous, fig.latest);
  const yearMonth = shiftMonth(month, -12)!;
  const prevMonth = shiftMonth(month, -1)!;
  const notes: string[] = [];
  if (behind >= 4) notes.push(`Old data: the newest Stats NZ release we hold is for ${monthWords(month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "New Zealand",
    item: { code: def.code, definition: def.label, unit: def.unit, asked_for: q.item },
    what_this_is: "Monthly weighted average price published by Stats NZ for its selected price indexes. Not a receipt and not the price at any one shop.",
    reference_month: month,
    reference_month_label: monthWords(month),
    change_on_year_earlier: yoy && fig.yearAgo !== null ? { reference_month: yearMonth, value: fig.yearAgo, ...yoy } : null,
    change_on_previous_month: mom && fig.previous !== null ? { reference_month: prevMonth, value: fig.previous, ...mom } : null,
    other_definitions: related.filter((d) => snap.figures.has(d.code)).map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    library_snapshot_date: snap.date,
    dataset: { title: "Selected price indexes (Food Price Index selected monthly weighted average prices)", url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: fig.latest,
    unit: def.unit,
    period: { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` },
    reference_period: month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In New Zealand the national weighted average price of "${def.label}" was ${nzd(v)} in ${monthWords(month)} (Stats NZ selected price indexes, not receipts).` +
      (yoy && fig.yearAgo !== null
        ? yoy.change_percent === 0
          ? ` That is unchanged from ${monthWords(yearMonth)} (${nzd(fig.yearAgo)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${nzd(fig.yearAgo)} in ${monthWords(yearMonth)}).`
        : " No price for the same month a year earlier is available."),
    extra,
  });
}

// ---------- the request ----------

export async function nzGroceryPrices(input: NzQuery, o: { snapshot?: Snapshot | null } = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'bread' or 'eggs'.");
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("ProofPrice collects Stats NZ's selected prices daily; data appears after the next collection.");
  const m = matchItem(ITEMS, item);
  return nzAnswer(snap, m.primary, m.related, input);
}

/** Where a request lives in the library, without asking Stats NZ. */
export function nzHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const m = p.item ? matchItem(ITEMS, p.item).primary : null;
  return m ? { area: "ALL", item: m.code, label: m.label } : null;
}
