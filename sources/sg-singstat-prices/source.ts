// Singapore: Average Retail Prices of Selected Consumer Items, monthly (SingStat Table Builder table M213761).
// Format checked live on 2026-10-24 through the GitHub probe (GET, no key):
//   https://tablebuilder.singstat.gov.sg/api/table/tabledata/M213761?limit=2000&offset=0&timeFilter=2026%20Sep
//   -> { Data: { id, title, footnote, dataLastUpdated: "23/10/2026", row: [ { seriesNo, rowText: "Whole Chicken, Chilled (Per Kilogram)",
//        uoM: "Dollar", footnote, columns: [ { key: "2026 Sep", value: "8.68" } ] }, ... ] } }
// One call returns all 85 items for one month (about 13 KB). SingStat publishes one national average per item and month (no
// distribution, no record count), so the answer is an official statistic. We serve the food, drink, hawker-meal and household items;
// petrol, diesel, LPG and cigarettes are left out (they belong to the fuel tool / are not groceries).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "sg-singstat-prices",
  country: "SG (Singapore)",
  category: "groceries (average shop and hawker prices of selected consumer items)",
  name: "Average Retail Prices of Selected Consumer Items, Monthly (SingStat table M213761)",
  publisher: "Department of Statistics Singapore (SingStat)",
  what_is_recorded:
    "For about 75 food, drink, hawker-meal and household items, the national average retail price each month (Singapore dollars per kg, litre, pack or plate as stated), " +
    "from the prices SingStat records for the Consumer Price Index. One published average per item and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, about three weeks after the month ends, with the month named in every answer",
  licence:
    "Singapore Open Data Licence v1.0. SingStat's Terms of Use say that use of Datasets made available through its website (including the Table Builder) is subject to the Singapore Open Data Licence, " +
    "which allows worldwide, perpetual, royalty-free use, commercially or non-commercially, with acknowledgement of the source and a link to the licence.",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Average Retail Prices of Selected Consumer Items (SingStat table M213761) accessed on the date in this answer's retrieved_at field from the Department of Statistics Singapore (SingStat), " +
    "which is made available under the terms of the Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence . " +
    "Figures are passed on as published; the change on a year earlier is calculated by ProofPrice. This is not an official SingStat product and SingStat does not endorse it.",
  homepage: "https://tablebuilder.singstat.gov.sg/table/TS/M213761",
  limits:
    "National averages only (no regional prices), for SingStat's standard items and pack sizes; SingStat does not say how many price quotes stand behind an average. " +
    "These are shelf and stall prices recorded for the Consumer Price Index, not receipts, and not the price at any one shop. " +
    "From January 2024 the items are based on the 2024 CPI basket, so brands, varieties and outlets can change between baskets.",
};

export const TABLE_CODE = "M213761";
export const TABLE_URL = "https://tablebuilder.singstat.gov.sg/api/table/tabledata/M213761";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------- the items: SingStat's exact row text -> everyday words ----------
// The code is SingStat's row text exactly as published (checked 2026-10-24), matched case-insensitively.
const def = (code: string, label: string, unit: string, ...words: string[]): ItemDef => ({ code, label, unit, words });
export const ITEMS: ItemDef[] = [
  def("Premium Thai Rice (Per 5 Kilogram)", "Premium Thai rice, 5 kg", "per 5 kg", "rice", "thai rice", "premium thai rice"),
  def("Wholemeal Bread (Per 400 Gram)", "Wholemeal bread, 400 g", "per 400 g", "bread", "wholemeal bread", "loaf"),
  def("Sausage Bun (Each)", "Sausage bun", "each", "sausage bun"),
  def("Instant Noodles (Per 5 Packets)", "Instant noodles, 5 packets", "per 5 packets", "instant noodles", "noodles"),
  def("Cracker (Per 100 Gram)", "Cracker, 100 g", "per 100 g", "cracker", "crackers"),
  def("Canned Baked Beans (Per 100 Gram)", "Canned baked beans, 100 g", "per 100 g", "baked beans", "canned baked beans"),
  def("Canned Sardines (Per 100 Gram)", "Canned sardines, 100 g", "per 100 g", "sardines", "canned sardines"),
  def("Canned Luncheon Meat (Per 100 Gram)", "Canned luncheon meat, 100 g", "per 100 g", "luncheon meat", "canned luncheon meat", "spam"),
  def("Lean Pork, Chilled (Per Kilogram)", "Lean pork, chilled, 1 kg", "per kg", "pork", "lean pork", "chilled pork"),
  def("Streaky Pork, Chilled (Per Kilogram)", "Streaky pork, chilled, 1 kg", "per kg", "streaky pork", "pork belly"),
  def("Pork Rib Bones, Chilled (Per Kilogram)", "Pork rib bones, chilled, 1 kg", "per kg", "pork ribs", "pork rib bones", "ribs"),
  def("Ribeye Beef, Chilled (Per Kilogram)", "Ribeye beef, chilled, 1 kg", "per kg", "beef", "ribeye", "ribeye beef", "steak"),
  def("Mutton, Chilled (Per Kilogram)", "Mutton, chilled, 1 kg", "per kg", "mutton", "lamb"),
  def("Whole Chicken, Chilled (Per Kilogram)", "Whole chicken, chilled, 1 kg", "per kg", "chicken", "whole chicken", "chilled chicken"),
  def("Chicken Wing, Chilled (Per Kilogram)", "Chicken wing, chilled, 1 kg", "per kg", "chicken wing", "chicken wings"),
  def("Lean Pork, Frozen (Per 500 Gram)", "Lean pork, frozen, 500 g", "per 500 g", "frozen pork", "lean pork frozen"),
  def("Pork Rib Bones, Frozen (Per 500 Gram)", "Pork rib bones, frozen, 500 g", "per 500 g", "frozen pork ribs"),
  def("Beef Cube, Frozen (Per 500 Gram)", "Beef cube, frozen, 500 g", "per 500 g", "frozen beef", "beef cube"),
  def("Whole Chicken, Frozen (Each)", "Whole chicken, frozen", "each", "frozen chicken", "whole frozen chicken"),
  def("Chicken Wing, Frozen (Per 2 Kilogram)", "Chicken wing, frozen, 2 kg", "per 2 kg", "frozen chicken wings", "frozen chicken wing"),
  def("Cod Fish (Per Kilogram)", "Cod fish, 1 kg", "per kg", "cod", "cod fish"),
  def("Flowery Grouper (Per Kilogram)", "Flowery grouper, 1 kg", "per kg", "grouper", "flowery grouper"),
  def("White Pomfret (Per Kilogram)", "White pomfret, 1 kg", "per kg", "pomfret", "white pomfret"),
  def("Salmon (Per Kilogram)", "Salmon, 1 kg", "per kg", "salmon"),
  def("Sea Bass (Per Kilogram)", "Sea bass, 1 kg", "per kg", "sea bass", "seabass"),
  def("Golden Snapper (Per Kilogram)", "Golden snapper, 1 kg", "per kg", "snapper", "golden snapper"),
  def("Spanish Mackerel (Batang) (Per Kilogram)", "Spanish mackerel (batang), 1 kg", "per kg", "mackerel", "spanish mackerel", "batang"),
  def("Threadfin (Kurau) (Per Kilogram)", "Threadfin (kurau), 1 kg", "per kg", "threadfin", "kurau"),
  def("Medium Prawns (Per Kilogram)", "Medium prawns, 1 kg", "per kg", "prawns", "prawn", "shrimp", "medium prawns"),
  def("Squids (Per Kilogram)", "Squid, 1 kg", "per kg", "squid", "squids", "cuttlefish"),
  def("Fresh Milk (Per Litre)", "Fresh milk, 1 litre", "per litre", "milk", "fresh milk"),
  def("Infant Milk Powder (Per 100 Gram)", "Infant milk powder, 100 g", "per 100 g", "infant milk powder", "baby formula", "formula", "milk powder"),
  def("Cheese (Per 12 Slices)", "Cheese, 12 slices", "per 12 slices", "cheese", "cheese slices"),
  def("Hen Eggs (Per 10)", "Hen eggs, 10", "per 10 eggs", "eggs", "egg", "hen eggs"),
  def("Cooking Oil (Per 2 Kilogram)", "Cooking oil, 2 kg", "per 2 kg", "cooking oil", "oil", "vegetable oil"),
  def("Bananas (Per Kilogram)", "Bananas, 1 kg", "per kg", "bananas", "banana"),
  def("Papaya (Per Kilogram)", "Papaya, 1 kg", "per kg", "papaya"),
  def("Watermelon (Per Kilogram)", "Watermelon, 1 kg", "per kg", "watermelon"),
  def("Grapes (Per Kilogram)", "Grapes, 1 kg", "per kg", "grapes"),
  def("Orange (Each)", "Orange", "each", "orange", "oranges"),
  def("Apple (Each)", "Apple", "each", "apple", "apples"),
  def("Broccoli (Per Kilogram)", "Broccoli, 1 kg", "per kg", "broccoli"),
  def("Cabbage (Per Kilogram)", "Cabbage, 1 kg", "per kg", "cabbage"),
  def("Chinese Kale (Kailan) (Per Kilogram)", "Chinese kale (kailan), 1 kg", "per kg", "kailan", "chinese kale"),
  def("Small Mustard (Chye Sim) (Per Kilogram)", "Small mustard (chye sim), 1 kg", "per kg", "chye sim", "small mustard", "choy sum"),
  def("Tomatoes (Per Kilogram)", "Tomatoes, 1 kg", "per kg", "tomatoes", "tomato"),
  def("Potatoes (Per Kilogram)", "Potatoes, 1 kg", "per kg", "potatoes", "potato"),
  def("Carrots (Per Kilogram)", "Carrots, 1 kg", "per kg", "carrots", "carrot"),
  def("Small Onions (Per Kilogram)", "Small onions, 1 kg", "per kg", "onions", "onion", "small onions"),
  def("Old Ginger (Per Kilogram)", "Old ginger, 1 kg", "per kg", "ginger", "old ginger"),
  def("Light Soy Sauce (640 Ml)", "Light soy sauce, 640 ml", "per 640 ml", "soy sauce", "light soy sauce"),
  def("White Sugar (Per 2 Kilogram)", "White sugar, 2 kg", "per 2 kg", "sugar", "white sugar"),
  def("Instant Coffee (Per 200 Gram)", "Instant coffee, 200 g", "per 200 g", "coffee", "instant coffee"),
  def("Aerated Soft Drinks (Per 4 Cans)", "Aerated soft drinks, 4 cans", "per 4 cans", "soft drink", "soda", "cola", "aerated soft drinks"),
  def("Non-Aerated Soft Drinks (Per 6 Packets)", "Non-aerated soft drinks, 6 packets", "per 6 packets", "packet drink", "non aerated soft drinks", "juice drink"),
  def("Beer (Per 6 Cans)", "Beer, 6 cans", "per 6 cans", "beer", "lager"),
  def("Coffee/Tea Without Milk (Per Cup)", "Coffee or tea without milk, per cup (kopi o / teh o)", "per cup", "kopi o", "teh o", "black coffee", "tea", "coffee or tea"),
  def("Coffee/Tea With Condensed Milk (Per Cup)", "Coffee or tea with condensed milk, per cup (kopi / teh)", "per cup", "kopi", "teh", "coffee with milk", "tea with milk"),
  def("Milo With Condensed Milk (Per Cup)", "Milo with condensed milk, per cup", "per cup", "milo"),
  def("Canned Drink With Ice (Per Can)", "Canned drink with ice, per can", "per can", "canned drink"),
  def("Fishball Noodles (Per Bowl)", "Fishball noodles, per bowl", "per bowl", "fishball noodles", "fish ball noodles"),
  def("Mee Rebus (Per Bowl)", "Mee rebus, per bowl", "per bowl", "mee rebus"),
  def("Mee Siam (Per Bowl)", "Mee siam, per bowl", "per bowl", "mee siam"),
  def("Char Kway Teow (Per Plate)", "Char kway teow, per plate", "per plate", "char kway teow", "char kuay teow"),
  def("Sliced Fish Bee Hoon (Per Bowl)", "Sliced fish bee hoon, per bowl", "per bowl", "fish bee hoon", "sliced fish bee hoon"),
  def("Wanton Noodles (Per Plate)", "Wanton noodles, per plate", "per plate", "wanton noodles", "wonton noodles"),
  def("Char Siew Rice (Per Plate)", "Char siew rice, per plate", "per plate", "char siew rice", "char siu rice"),
  def("Chicken Rice (Per Plate)", "Chicken rice, per plate", "per plate", "chicken rice", "hainanese chicken rice"),
  def("Duck Rice (Per Plate)", "Duck rice, per plate", "per plate", "duck rice"),
  def("Chicken Nasi Briyani (Per Plate)", "Chicken nasi briyani, per plate", "per plate", "briyani", "biryani", "nasi briyani", "chicken briyani"),
  def("Economical Rice (1 Meat & 2 Vegetables) (Per Plate)", "Economical rice (1 meat and 2 vegetables), per plate", "per plate", "economical rice", "economy rice", "cai fan"),
  def("Saba Fish With Rice (Per Plate)", "Saba fish with rice, per plate", "per plate", "saba fish rice", "saba fish with rice"),
  def("Chicken Chop (Per Plate)", "Chicken chop, per plate", "per plate", "chicken chop"),
  def("Roti Prata (Plain) (Per Piece)", "Roti prata (plain), per piece", "per piece", "roti prata", "prata"),
  def("Fried Carrot Cake (Per Plate)", "Fried carrot cake, per plate", "per plate", "carrot cake", "fried carrot cake"),
  def("Ice Kachang (Per Bowl)", "Ice kachang, per bowl", "per bowl", "ice kachang"),
  def("Laundry Liquid Detergent (Per Kilogram)", "Laundry liquid detergent, 1 kg", "per kg", "laundry detergent", "detergent", "washing liquid"),
  def("Toilet Paper (10 Rolls)", "Toilet paper, 10 rolls", "per 10 rolls", "toilet paper", "toilet roll"),
  def("Baby Diapers (60 Pieces Per Pack)", "Baby diapers, 60 pieces", "per pack of 60", "diapers", "nappies", "baby diapers"),
];

// ---------- reading the table (pure) ----------

export interface SgRow {
  rowText: string;
  value: number;
}

export interface SgMonth {
  /** "2026-09", from the column key "2026 Sep". */
  month: string;
  rows: Map<string, SgRow>;
  dataLastUpdated: string | null;
  footnote: string | null;
  title: string | null;
}

export const keyOf = (rowText: string): string => rowText.trim().toLowerCase();

/** "2026 Sep" -> "2026-09"; null when it is not a SingStat month key. */
export function monthFromKey(key: string): string | null {
  const m = /^(\d{4}) ([A-Za-z]{3})$/.exec(key.trim());
  if (!m) return null;
  const i = MONTH_ABBR.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return i < 0 ? null : `${m[1]}-${String(i + 1).padStart(2, "0")}`;
}

/** "2026-09" -> "2026 Sep" (the timeFilter SingStat expects). */
export function keyFromMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`bad month ${month}`);
  return `${m[1]} ${MONTH_ABBR[Number(m[2]) - 1]}`;
}

export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** "2026-09" -> "September 2026" */
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** Whole months between the reference month and `today`. */
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 0;
  return today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

/** "23/10/2026" -> "2026-10-23" */
export function isoFromSgDate(text: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text ?? "").trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** Parse one table-data response for one month. Throws SourceError when the shape is not SingStat's; returns no rows for a month without prices. */
export function parseMonth(json: unknown, month: string): SgMonth {
  const data = (json as any)?.Data;
  if (!data || !Array.isArray(data.row)) throw new SourceError("SingStat table M213761 returned an unexpected shape (no Data.row).");
  const key = keyFromMonth(month);
  const rows = new Map<string, SgRow>();
  for (const r of data.row) {
    const text = String(r?.rowText ?? "").trim();
    const col = Array.isArray(r?.columns) ? r.columns.find((c: any) => String(c?.key).trim() === key) : null;
    const value = Number(col?.value);
    if (text && col && Number.isFinite(value) && value > 0) rows.set(keyOf(text), { rowText: text, value });
  }
  return { month, rows, dataLastUpdated: isoFromSgDate(data.dataLastUpdated), footnote: typeof data.footnote === "string" ? data.footnote : null, title: typeof data.title === "string" ? data.title : null };
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const sgd = (v: number) => `S$${v.toFixed(2)}`;

export interface Change {
  from_month: string;
  from_value: number;
  change_percent: number;
  change_amount: number;
}

export function changeOver(from: number | null | undefined, fromMonth: string, to: number): Change | null {
  if (typeof from !== "number" || !(from > 0)) return null;
  return { from_month: fromMonth, from_value: from, change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: roundTo(to - from, 3) };
}

function changeWords(c: Change): string {
  if (c.change_percent === 0) return ` That is unchanged from ${monthWords(c.from_month)} a year earlier (${sgd(c.from_value)}).`;
  return ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than a year earlier (${sgd(c.from_value)} in ${monthWords(c.from_month)}).`;
}

const SG_WORDS = new Set(["sg", "singapore", "sgp", "national", "nationwide", "all", "whole country", "republic of singapore"]);

export function sgMethod(): string {
  return (
    "The Department of Statistics Singapore (SingStat) publishes, each month, the national average retail price of about 75 food, drink, hawker-meal and household items (table M213761), " +
    "from the prices it records for the Consumer Price Index. ProofPrice returns the published average for the item's latest month, unchanged, with the month before and the same month a year earlier. " +
    "No range is calculated: SingStat gives one average and does not say how many price quotes are behind it. These are shelf and stall prices recorded for statistics, not receipts."
  );
}

export interface SgQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export interface SgReading {
  latest: SgMonth;
  previous: SgMonth | null;
  yearAgo: SgMonth | null;
}

export function sgAnswer(reading: SgReading | null, d: ItemDef | null, related: ItemDef[], q: SgQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "SG", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const regionNote =
    q.region && !SG_WORDS.has(q.region.trim().toLowerCase())
      ? `SingStat publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Singapore.`
      : undefined;
  const base = { source: INFO, query, measure: "average" as const, currency: "SGD", method: sgMethod(), baseUrl: q.baseUrl };
  const row = reading && d ? reading.latest.rows.get(keyOf(d.code)) : undefined;

  if (!d || !reading || !row) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: d?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = d ? `SingStat's table holds no price for "${d.label}" in ${reading ? monthWords(reading.latest.month) : "the latest months"}.` : `SingStat's average-price table has no standard item for "${q.item}".`;
    return { ...none, summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`, extra: { available_items: exampleWords(ITEMS, 80), ...(regionNote ? { region_note: regionNote } : {}) } };
  }

  const month = reading.latest.month;
  const today = q.today ?? new Date();
  const behind = monthsBehind(month, today);
  const prevRow = reading.previous?.rows.get(keyOf(d.code));
  const yearRow = reading.yearAgo?.rows.get(keyOf(d.code));
  const yoy = changeOver(yearRow?.value, reading.yearAgo?.month ?? shiftMonth(month, -12), row.value);
  const mom = changeOver(prevRow?.value, reading.previous?.month ?? shiftMonth(month, -1), row.value);
  const notes: string[] = [];
  if (behind >= 4) notes.push(`Old data: the newest month SingStat holds is ${monthWords(month)}, ${behind} months ago.`);
  if (yearRow && shiftMonth(month, -12) < "2024-01") notes.push("The year-earlier price comes from before the 2024 CPI basket, so the items and outlets priced may differ.");
  if (regionNote) notes.push(regionNote);
  const [from, to] = [`${month}-01`, `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`];

  const extra: Record<string, unknown> = {
    country_name: "Singapore",
    item: { definition: d.label, unit: d.unit, singstat_label: row.rowText, asked_for: q.item },
    what_this_is: "Average retail price recorded by the Department of Statistics Singapore for the Consumer Price Index. Not a receipt and not the price at any one shop or stall.",
    reference_month: month,
    reference_month_label: monthWords(month),
    change_on_year_earlier: yoy ? { reference_month: yoy.from_month, value: yoy.from_value, change_percent: yoy.change_percent, change_amount: yoy.change_amount } : null,
    change_on_previous_month: mom ? { reference_month: mom.from_month, value: mom.from_value, change_percent: mom.change_percent, change_amount: mom.change_amount } : null,
    other_definitions: related.map((r) => ({ item: r.words[0], definition: r.label, unit: r.unit })),
    dataset: { code: TABLE_CODE, title: reading.latest.title, data_last_updated: reading.latest.dataLastUpdated, url: INFO.homepage },
    basket_note: reading.latest.footnote,
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: row.value,
    unit: d.unit,
    period: { from, to },
    reference_period: month,
    note: notes.length ? notes.join(" ") : undefined,
    published: reading.latest.dataLastUpdated,
    describe: (v) =>
      `In Singapore the national average price of "${d.label}" was ${sgd(v)} in ${monthWords(month)}` +
      ` (Department of Statistics Singapore, Consumer Price Index price survey, not receipts).` +
      (yoy ? changeWords(yoy) : " No price for the same month a year earlier is available.") +
      (behind >= 4 ? ` Old data: this is ${behind} months old.` : ""),
    extra,
  });
}

// ---------- the request ----------

export interface SgOptions {
  /** Replace the GET (tests). Default: lib/http fetchJson. */
  getter?: (url: string) => Promise<unknown>;
  timeoutMs?: number;
}

export function monthUrl(month: string): string {
  return `${TABLE_URL}?limit=2000&offset=0&timeFilter=${encodeURIComponent(keyFromMonth(month))}`;
}

/** Newest month that holds prices (tries the last three months), plus the month before and the same month a year earlier. */
export async function readLatest(today: Date, o: SgOptions = {}): Promise<SgReading> {
  const get = o.getter ?? ((url: string) => fetchJson(url, {}, o.timeoutMs ?? 20000));
  const thisMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  let latest: SgMonth | null = null;
  for (const back of [1, 2, 3]) {
    const month = shiftMonth(thisMonth, -back);
    const parsed = parseMonth(await get(monthUrl(month)), month);
    if (parsed.rows.size) { latest = parsed; break; }
  }
  if (!latest) throw new SourceError("SingStat table M213761 holds no prices for the last three months.");
  const [previous, yearAgo] = await Promise.all(
    [shiftMonth(latest.month, -1), shiftMonth(latest.month, -12)].map(async (m) => {
      try { const p = parseMonth(await get(monthUrl(m)), m); return p.rows.size ? p : null; } catch { return null; }
    }),
  );
  return { latest, previous, yearAgo };
}

export async function sgSingstatPrices(input: SgQuery, o: SgOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'eggs', 'chicken rice' or 'bread'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return sgAnswer(null, null, [], input);
  const reading = await readLatest(input.today ?? new Date(), o);
  return sgAnswer(reading, m.primary, m.related, input);
}
