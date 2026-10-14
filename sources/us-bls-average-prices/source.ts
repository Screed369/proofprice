// United States: CPI Average Price Data (series APU...) from the U.S. Bureau of Labor Statistics. Format checked live on
// 2026-10-14 through the GitHub probe. The flat files live at https://download.bls.gov/pub/time.series/ap/ :
//   ap.data.0.Current  ~9 MB  every current average-price series, one line per month: series_id <tab> year <tab> period <tab> value <tab> footnotes
//   ap.item / ap.area  small mapping files (item codes, area codes)
// A series id is APU + area code (4) + item code: APU0000708111 = eggs, grade A large, per dozen, U.S. city average.
//
// We never download the 9 MB file per request. The daily collector (harvest, on GitHub Actions) reads it once and keeps, for every
// item and area (U.S. city average and the four regions), the latest month, the same month a year earlier and the month before in
// the price library; requests are answered from there. BLS publishes ONE average per series and month: no distribution, no number
// of quotes, so the answer is an official statistic (value + measure "average", range fields null, sample_size null).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "us-bls-average-prices",
  country: "US (United States)",
  category: "groceries (average retail food prices)",
  name: "CPI Average Price Data (AP): food, drink and household items",
  publisher: "U.S. Bureau of Labor Statistics (BLS)",
  what_is_recorded:
    "For about 50 food and drink items (eggs, milk, bread, coffee, beef, bananas, beer ...), the average retail price each month for the U.S. city average and the four census regions, " +
    "calculated by BLS from the prices its data collectors record in stores for the Consumer Price Index. One published average per series and month; never an individual store or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly: BLS releases the new month about the 10th to 14th of the following month; our copy is refreshed daily and each answer states its reference month",
  licence:
    "Public domain. BLS states: \"The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, both in hard copy and electronically, is in the public domain, " +
    "except for previously copyrighted photographs and illustrations. You are free to use our public domain material without specific permission, although we do ask that you cite the Bureau of Labor Statistics as the source.\"",
  licence_url: "https://www.bls.gov/opub/copyright-information.htm",
  attribution:
    "Source: U.S. Bureau of Labor Statistics, CPI Average Price Data (series APU), https://download.bls.gov/pub/time.series/ap/ . Public domain; BLS asks that it is cited as the source. " +
    "Prices are passed on as published; the change on a year earlier is calculated by ProofPrice. ProofPrice is not endorsed by BLS.",
  homepage: "https://download.bls.gov/pub/time.series/ap/",
  limits:
    "Average retail prices for BLS's standard items and pack sizes (often per pound, not per pack), for the U.S. city average and four regions; many items are published for the national average only. " +
    "BLS says average prices are best used to measure the price level in a particular month, not to measure price change over time (its CPI index values are better for that). " +
    "BLS does not say how many price quotes stand behind an average. These are store shelf prices recorded for the Consumer Price Index, not receipts. " +
    "Some months are missing (for example October 2025, when no data were collected during the federal funding lapse); BLS no longer publishes some items, such as apples and tea.",
};

export const AP_DATA_URL = "https://download.bls.gov/pub/time.series/ap/ap.data.0.Current";
/** BLS asks every download to carry a User-Agent with contact details. */
export const BLS_USER_AGENT = "ProofPrice/1.0 (hello@proofprice.com)";

/** What the library's `n` column holds for a BLS average: the library keeps no row below MIN_PUBLISH records, and BLS does not publish a count, so every row carries this placeholder. Answers report sample_size null. */
export const LIBRARY_N_PLACEHOLDER = MIN_PUBLISH;

// ---------- areas ----------

export interface Area {
  code: string;
  name: string;
  words: string[];
}

export const NATIONAL_AREA = "0000";

export const AREAS: Area[] = [
  { code: "0000", name: "U.S. city average", words: ["us", "usa", "u s", "united states", "america", "national", "nationwide", "country", "city average", "u s city average", "all"] },
  { code: "0100", name: "Northeast region", words: ["northeast", "north east", "north eastern", "northeastern"] },
  { code: "0200", name: "Midwest region", words: ["midwest", "mid west", "midwestern"] },
  { code: "0300", name: "South region", words: ["south", "southern"] },
  { code: "0400", name: "West region", words: ["west", "western"] },
];

const REGION_STATES: Record<string, string[]> = {
  "0100": ["connecticut", "maine", "massachusetts", "new hampshire", "rhode island", "vermont", "new jersey", "new york", "pennsylvania"],
  "0200": ["illinois", "indiana", "michigan", "ohio", "wisconsin", "iowa", "kansas", "minnesota", "missouri", "nebraska", "north dakota", "south dakota"],
  "0300": ["delaware", "district of columbia", "washington dc", "florida", "georgia", "maryland", "north carolina", "south carolina", "virginia", "west virginia", "alabama", "kentucky", "mississippi", "tennessee", "arkansas", "louisiana", "oklahoma", "texas"],
  "0400": ["arizona", "colorado", "idaho", "montana", "nevada", "new mexico", "utah", "wyoming", "alaska", "california", "hawaii", "oregon", "washington"],
};

function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "south", "Texas", "US" -> the BLS area. A US state maps to its census region (BLS publishes four regions, not states). Throws InputError for anything else. */
export function resolveArea(region?: string): { area: Area; note?: string } {
  const r = plain(region ?? "");
  if (!r) return { area: AREAS[0] };
  const hit = AREAS.find((a) => a.words.includes(r) || plain(a.name) === r || plain(a.name.replace(/ region$/, "")) === r);
  if (hit) return { area: hit };
  for (const [code, states] of Object.entries(REGION_STATES)) {
    if (states.includes(r)) {
      const area = AREAS.find((a) => a.code === code)!;
      return { area, note: `BLS publishes average prices for four regions, not states: "${region}" is in the ${area.name}.` };
    }
  }
  throw new InputError(`region must be one of: northeast, midwest, south, west (or a US state, which maps to its region), or left out for the U.S. city average. Not recognised: ${region}.`);
}

// ---------- the items: everyday words -> BLS item codes ----------

/** BLS item codes (ap.item) that are still priced, with our plain definitions. Series for items BLS has dropped (apples, tea ...) are not listed. */
export const ITEMS: ItemDef[] = [
  { code: "709112", label: "Whole milk, per gallon (3.8 litres)", unit: "per gallon (3.8 litres)", words: ["milk", "whole milk", "full fat milk", "fresh milk", "gallon of milk"] },
  { code: "FJ1101", label: "Low-fat, reduced-fat or skim milk, per gallon (3.8 litres)", unit: "per gallon (3.8 litres)", words: ["low fat milk", "lowfat milk", "skim milk", "skimmed milk", "semi skimmed milk", "reduced fat milk", "1% milk", "2% milk"] },
  { code: "708111", label: "Eggs, grade A, large, per dozen", unit: "per dozen", words: ["eggs", "egg", "dozen eggs", "large eggs", "a dozen eggs"] },
  { code: "702111", label: "White pan bread, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["bread", "white bread", "sliced bread", "loaf", "loaf of bread", "white loaf"] },
  { code: "FS1101", label: "Butter, stick, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["butter"] },
  { code: "710212", label: "Cheddar cheese, natural, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["cheese", "cheddar", "cheddar cheese"] },
  { code: "710211", label: "American processed cheese, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["american cheese", "processed cheese"] },
  { code: "706111", label: "Chicken, fresh, whole, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["chicken", "whole chicken", "fresh chicken", "roast chicken"] },
  { code: "FF1101", label: "Chicken breast, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["chicken breast", "boneless chicken breast", "chicken breasts"] },
  { code: "706212", label: "Chicken legs, bone-in, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["chicken legs", "chicken leg", "chicken drumstick"] },
  { code: "703112", label: "Ground beef, 100% beef, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["ground beef", "beef mince", "mince", "minced beef", "beef", "hamburger", "hamburger meat", "burger meat"] },
  { code: "703113", label: "Ground beef, lean and extra lean, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["lean ground beef", "lean mince", "lean beef mince"] },
  { code: "703111", label: "Ground chuck, 100% beef, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["ground chuck"] },
  { code: "703613", label: "Sirloin steak, USDA Choice, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["steak", "sirloin steak", "sirloin"] },
  { code: "703511", label: "Round steak, USDA Choice, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["round steak"] },
  { code: "703213", label: "Chuck roast, USDA Choice, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["chuck roast", "beef roast", "pot roast", "roast beef"] },
  { code: "703311", label: "Round roast, USDA Choice, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["round roast"] },
  { code: "703432", label: "Beef for stew, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["stew beef", "beef for stew", "stewing beef"] },
  { code: "704111", label: "Bacon, sliced, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["bacon"] },
  { code: "704212", label: "Pork chops, boneless, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["pork", "pork chops", "pork chop"] },
  { code: "704312", label: "Ham, boneless (excluding canned), per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["ham"] },
  { code: "711211", label: "Bananas, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["bananas", "banana"] },
  { code: "711311", label: "Oranges, navel, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["oranges", "orange"] },
  { code: "711412", label: "Lemons, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["lemons", "lemon"] },
  { code: "711411", label: "Grapefruit, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["grapefruit"] },
  { code: "711415", label: "Strawberries, dry pint, per 12 oz (340 g)", unit: "per 12 oz (340 g)", words: ["strawberries", "strawberry"] },
  { code: "712112", label: "Potatoes, white, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["potatoes", "potato"] },
  { code: "712311", label: "Tomatoes, field grown, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["tomatoes", "tomato"] },
  { code: "712211", label: "Lettuce, iceberg, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["lettuce", "iceberg lettuce"] },
  { code: "FL2101", label: "Lettuce, romaine, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["romaine lettuce", "romaine"] },
  { code: "701312", label: "Rice, white, long grain, uncooked, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["rice", "white rice", "long grain rice"] },
  { code: "701322", label: "Spaghetti and macaroni, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["pasta", "spaghetti", "macaroni"] },
  { code: "701111", label: "Flour, white, all purpose, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["flour", "white flour", "all purpose flour"] },
  { code: "715211", label: "Sugar, white, all sizes, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["sugar", "white sugar"] },
  { code: "717311", label: "Coffee, 100% ground roast, all sizes, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["coffee", "ground coffee", "roast coffee"] },
  { code: "FN1101", label: "Soft drinks (all), per 2 litres", unit: "per 2 litres", words: ["soft drinks", "soft drink", "soda", "cola", "pop"] },
  { code: "FN1102", label: "Soft drinks, 12-pack of 12 oz cans, per can", unit: "per 12 oz (355 ml) can", words: ["can of soda", "cans of soda", "soda cans"] },
  { code: "720111", label: "Malt beverages (beer), all types and sizes, per 16 oz (473 ml)", unit: "per 16 oz (473 ml)", words: ["beer", "malt beverage", "lager", "ale", "pint of beer"] },
  { code: "720311", label: "Wine, red and white table, all sizes, per litre", unit: "per litre", words: ["wine", "red wine", "white wine", "table wine", "bottle of wine"] },
  { code: "718311", label: "Potato chips, per 16 oz (453.6 g)", unit: "per 16 oz (453.6 g)", words: ["potato chips", "chips", "crisps"] },
  { code: "710411", label: "Ice cream, prepackaged, bulk, per half gallon (1.9 litres)", unit: "per half gallon (1.9 litres)", words: ["ice cream"] },
  { code: "FJ4101", label: "Yogurt, per 8 oz (227 g)", unit: "per 8 oz (227 g)", words: ["yogurt", "yoghurt"] },
  { code: "702421", label: "Cookies, chocolate chip, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["cookies", "cookie", "biscuits", "chocolate chip cookies"] },
  { code: "714221", label: "Canned corn, all styles and sizes, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["canned corn", "sweetcorn", "corn"] },
  { code: "714233", label: "Dried beans, all types and sizes, per lb (453.6 g)", unit: "per lb (453.6 g)", words: ["dried beans", "beans"] },
];

const ITEM_CODES = new Set(ITEMS.map((i) => i.code));

// ---------- the flat file (pure parsing) ----------

/** series key "<area>|<item>" -> month "YYYY-MM" -> average price */
export type SeriesMap = Map<string, Map<string, number>>;

/**
 * ap.data.0.Current: tab separated with a header line; columns series_id, year, period, value, footnote_codes (series ids and values are
 * space padded). Keeps monthly values (periods M01-M12; M13 is an annual average) of the wanted areas and item codes. A value of "-"
 * (no data, with a footnote such as X) is left out.
 */
export function parseApData(text: string, wantedItems: Set<string> = ITEM_CODES, wantedAreas: Set<string> = new Set(AREAS.map((a) => a.code))): SeriesMap {
  const out: SeriesMap = new Map();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 4) continue;
    const id = c[0].trim();
    if (id.length < 8 || !id.startsWith("APU")) continue;
    const area = id.slice(3, 7);
    const item = id.slice(7);
    if (!wantedAreas.has(area) || !wantedItems.has(item)) continue;
    const period = /^M(0[1-9]|1[0-2])$/.exec(c[2].trim());
    const year = /^\d{4}$/.test(c[1].trim()) ? c[1].trim() : null;
    if (!period || !year) continue;
    const value = Number(c[3].trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = `${area}|${item}`;
    let s = out.get(key);
    if (!s) out.set(key, (s = new Map()));
    s.set(`${year}-${period[1]}`, value);
  }
  return out;
}

export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)!;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const Y1 = "@y1"; // library item suffix: the same series a year before the library date
const M1 = "@m1"; // library item suffix: the month before the library date

function libraryRow(area: string, item: string, v: number): DailyRow {
  return { area, item, n: LIBRARY_N_PLACEHOLDER, median: v, low: v, high: v, min: v, max: v };
}

/**
 * Library rows for the newest month any series has. For every series priced in that month: the average (item = code), the same series
 * twelve months earlier (code@y1) and the month before (code@m1), when BLS has them. low, high, min and max repeat the one published
 * average (BLS gives no distribution) and n is a placeholder (BLS gives no count): see LIBRARY_N_PLACEHOLDER.
 */
export function usDailyRows(series: SeriesMap): { month: string; rows: DailyRow[] } | null {
  let month = "";
  for (const s of series.values()) for (const m of s.keys()) if (m > month) month = m;
  if (!month) return null;
  const rows: DailyRow[] = [];
  for (const [key, s] of series) {
    const v = s.get(month);
    if (v === undefined) continue;
    const [area, item] = key.split("|");
    rows.push(libraryRow(area, item, v));
    const y = s.get(shiftMonth(month, -12));
    if (y !== undefined) rows.push(libraryRow(area, item + Y1, y));
    const p = s.get(shiftMonth(month, -1));
    if (p !== undefined) rows.push(libraryRow(area, item + M1, p));
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { month, rows };
}

/** The daily collector: download the BLS average-price file once, return the newest month of every wanted series. */
export async function usHarvest(): Promise<HarvestResult> {
  const res = await fetch(AP_DATA_URL, { headers: { "user-agent": BLS_USER_AGENT } });
  if (!res.ok) throw new SourceError(`BLS average price data returned HTTP ${res.status}`);
  const day = usDailyRows(parseApData(Buffer.from(await res.arrayBuffer()).toString("utf8")));
  if (!day || !day.rows.length) throw new SourceError("BLS average price file held no usable monthly prices");
  const current = day.rows.filter((r) => !r.item.includes("@")).length;
  return {
    date: `${day.month}-01`,
    currency: "USD",
    unit: "per item (see the item definition)",
    rows: day.rows,
    note:
      `BLS CPI average prices for ${day.month}: ${current} series (items x U.S. city average and four regions), plus the same series a year earlier (item@y1) and a month earlier (item@m1). ` +
      `BLS publishes one average per series and month, so low/high/min/max repeat it and n is the library minimum (${LIBRARY_N_PLACEHOLDER}), not a count of quotes.`,
  };
}

// ---------- the answer (pure) ----------

export interface LibraryPoint {
  date: string; // YYYY-MM-01
  value: number;
}

export interface UsReading {
  item: string; // BLS item code
  area: Area;
  latest: LibraryPoint;
  yearAgo: LibraryPoint | null;
  previous: LibraryPoint | null;
  /** Other areas' current figures for the same item (national and regions), when held. */
  others: { area: Area; value: number }[];
  libraryLastDate: string | null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthOf = (date: string) => date.slice(0, 7);
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}
const usd = (v: number) => `$${v.toFixed(2)}`;
const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1) : 0;
}

export function usMethod(): string {
  return (
    "The U.S. Bureau of Labor Statistics publishes, each month, the average retail price of about 50 standard food and drink items for the U.S. city average and four regions, " +
    "calculated from the prices its data collectors record in stores for the Consumer Price Index (series APU). ProofPrice copies the file once a day and returns the published average for the item's newest month, unchanged, " +
    "with the same month a year earlier, the month before and the other regions. No range is calculated: BLS gives one average and does not say how many price quotes are behind it. These are store prices recorded for the index, not receipts."
  );
}

export interface UsQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function usAnswer(reading: UsReading | null, def: ItemDef | null, related: ItemDef[], q: UsQuery, regionNote?: string, areaAsked?: Area): PriceAnswer {
  const area = reading?.area ?? areaAsked ?? AREAS[0];
  const query: Record<string, unknown> = { country: "US", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "USD", method: usMethod(), baseUrl: q.baseUrl };

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `BLS publishes no recent "${def.label}" price for the ${area.name}${area.code === NATIONAL_AREA ? "" : "; try the U.S. city average (leave region out)"}.`
      : `BLS's average-price data has no standard item for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const month = monthOf(r.latest.date);
  const range = periodRange(month);
  const behind = monthsBehind(month, today);
  const change = (from: LibraryPoint | null) =>
    from ? { reference_month: monthOf(from.date), value: from.value, change_percent: roundTo(((r.latest.value - from.value) / from.value) * 100, 1), change_amount: roundTo(r.latest.value - from.value, 3) } : null;
  const yoy = change(r.yearAgo);
  const mom = change(r.previous);
  const notes: string[] = [];
  if (r.libraryLastDate && r.latest.date < r.libraryLastDate) notes.push(`BLS has no newer price for this item and area than ${monthWords(month)} (the newest month BLS holds for any item is ${monthWords(monthOf(r.libraryLastDate))}).`);
  if (behind >= 4) notes.push(`Old data: the newest price BLS holds for this item is from ${monthWords(month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "United States",
    area: { code: r.area.code, name: r.area.name },
    item: { code: def.code, definition: def.label, unit: def.unit, series_id: `APU${r.area.code}${def.code}`, asked_for: q.item },
    what_this_is: "Average store price recorded by BLS data collectors for the Consumer Price Index. Not a receipt and not the price at any one store.",
    reference_month: month,
    reference_month_label: monthWords(month),
    change_on_year_earlier: yoy,
    ...(yoy ? {} : { change_on_year_earlier_unavailable: "BLS holds no price for this series in the same month a year earlier (some months were not collected, for example October 2025)." }),
    change_on_previous_month: mom,
    other_areas: r.others.map((o) => ({ area: o.area.name, code: o.area.code, value: o.value })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    bls_note: "BLS: average prices are best used to measure the price level in a particular month, not to measure price change over time; its CPI index values are more appropriate for price change.",
    dataset: { name: "BLS CPI Average Price Data (AP)", url: INFO.homepage, newest_month_held: r.libraryLastDate ? monthOf(r.libraryLastDate) : null },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  const where = r.area.code === NATIONAL_AREA ? "the United States (U.S. city average)" : `the ${r.area.name} of the United States`;
  return buildStatisticAnswer({
    ...base,
    value: r.latest.value,
    unit: def.unit,
    period: range ?? { from: null, to: null },
    reference_period: month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the average retail price of "${def.label}" was ${usd(v)} in ${monthWords(month)} (Consumer Price Index store price collection, not receipts).` +
      (yoy
        ? yoy.change_percent === 0
          ? ` That is unchanged from a year earlier (${usd(yoy.value)} in ${monthWords(yoy.reference_month)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${usd(yoy.value)} in ${monthWords(yoy.reference_month)}).`
        : " BLS has no price for the same month a year earlier.") +
      (behind >= 4 ? ` Old data: this item has not been priced since ${monthWords(month)}.` : ""),
    extra,
  });
}

// ---------- the request ----------

function latestPoint(rows: { date: string; median: number }[]): LibraryPoint | null {
  const r = rows[rows.length - 1];
  return r ? { date: r.date, value: r.median } : null;
}

/** Read what the library holds for one item in one area: newest month, a year before and a month before (both only for that same newest date). */
export function readUsReading(item: string, area: Area, libraryLastDate: string, others = true): UsReading | null {
  const from = new Date(Date.parse(libraryLastDate + "T00:00:00Z") - 200 * 86400000).toISOString().slice(0, 10);
  const get = (areaCode: string, code: string) => readDaily(INFO.id, { area: areaCode, item: code, from, to: libraryLastDate });
  const latest = latestPoint(get(area.code, item));
  if (!latest) return null;
  // The @y1 and @m1 rows are stored under the newest month's date; the figure itself belongs to the earlier month.
  const same = (suffix: string, shift: number) => {
    const hit = get(area.code, item + suffix).find((r) => r.date === latest.date);
    return hit ? { date: `${shiftMonth(monthOf(latest.date), shift)}-01`, value: hit.median } : null;
  };
  const otherAreas: { area: Area; value: number }[] = [];
  if (others) {
    for (const a of AREAS) {
      if (a.code === area.code) continue;
      const hit = get(a.code, item).filter((r) => r.date === latest.date).pop();
      if (hit) otherAreas.push({ area: a, value: hit.median });
    }
  }
  return { item, area, latest, yearAgo: same(Y1, -12), previous: same(M1, -1), others: otherAreas, libraryLastDate };
}

export async function usBlsPrices(input: UsQuery): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'eggs', 'milk' or 'coffee'.");
  const { area, note } = resolveArea(input.region);
  const m = matchItem(ITEMS, item);
  if (!m.primary) return usAnswer(null, null, [], input, note, area);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects the BLS average prices daily; data appears after the next collection.");
  const reading = readUsReading(m.primary.code, area, meta.last_date);
  return usAnswer(reading, m.primary, m.related, input, note, area);
}
