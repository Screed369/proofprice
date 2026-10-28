// Austria: STATISTIK AUSTRIA "Preisradar" (price radar): monthly food prices from retailers' scanner (till) data, after discounts, for 100 standard
// food items. Format checked on 2026-10-28 from GitHub's servers (the workspace shell cannot reach statistik.at):
//   https://www.statistik.at/preisradar/data/ep/products.json   -> {"products":[{"id":"001900","label_de":"Langkornreis","label_en":"Long grain rice","level":1}, ...]} (100 items)
//   https://www.statistik.at/preisradar/data/ep/<id>.json        -> {"productId":"001900","productTitle_de":"Langkornreis (1000 Gramm)","productTitle_en":"Long grain rice (1000 gram)",
//        "price":{"rangeData":[[ts_ms,p25,p75],...],"medianData":[[ts_ms,median],...],"meanData":[[ts_ms,mean],...]},"indices":{...},...}
// ts_ms is the first day of the month at 00:00 UTC; values are euro per the unit named in the title; a missing value is the string "NA".
//
// Statistik Austria publishes, per item and month, the median and mean scanner price and the 25th-75th percentile range. It publishes no record
// count, so the answer is an official statistic (value = median, no count). The range is the 25th-75th percentile, NOT the 10th-90th: we show it
// in extra.interquartile_range and leave typical_low / typical_high empty so nobody reads it as p10-p90.
//
// Requests are answered live from the one small file of the item; the daily collector (harvest) stores, for every item, the newest month, the
// month before and the same month a year earlier, which also lets the shared stale-if-error path answer from our copy when statistik.at is down.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "at-statistik-preisradar",
  country: "AT (Austria)",
  category: "groceries (monthly median scanner-data prices of 100 food items)",
  name: "Preisradar (price radar): food prices from retail scanner data, STATISTIK AUSTRIA",
  publisher: "STATISTIK AUSTRIA (Bundesanstalt Statistik Österreich)",
  what_is_recorded:
    "For 100 standard food and drink items, the monthly median, mean and 25th-75th percentile range of prices in euro per the unit stated (for example 1000 gram), " +
    "computed by STATISTIK AUSTRIA from the till (scanner) data of retailers, after discounts. One published figure per item and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, in the middle of the following month; collected into our price library every day, each answer states its reference month",
  licence:
    "STATISTIK AUSTRIA legal notice (read 2026-10-28): provided the source \"STATISTIK AUSTRIA\" is cited and the content is reproduced accurately, it may be reproduced, distributed and made publicly available for commercial and non-commercial purposes; " +
    "where data content is extracted or otherwise modified, a note must say it was edited.",
  licence_url: "https://www.statistik.at/en/about-us/responsibilities-and-principles/legal-basis/website-information",
  attribution:
    "Source: STATISTIK AUSTRIA, Preisradar (https://www.statistik.at/preisradar/). Content edited by ProofPrice: we select the item, show the monthly median and calculate the changes; STATISTIK AUSTRIA has not reviewed it.",
  homepage: "https://www.statistik.at/preisradar/",
  limits:
    "National figures only (no regions) for STATISTIK AUSTRIA's 100 standard items and pack sizes. The figures come from retailers' scanner data after discounts, not from receipts; " +
    "the publisher gives no count of the sales behind a figure and its range is the 25th to 75th percentile, not the 10th to 90th. Items can change definition between releases.",
};

// ---------- the items: everyday words -> Preisradar product id ----------
// Labels are Statistik Austria's English product names (products.json, read 2026-10-28); the pack size is read from the item's own file
// (its productTitle_en, for example "Long grain rice (1000 gram)"). The first definition that lists a word is the default for it.
export const ITEMS: ItemDef[] = [
  { code: "005661", label: "Fresh milk", unit: "", words: ["fresh milk", "milk", "whole milk", "full-fat milk"] },
  { code: "005660", label: "Extended shelf life  milk", unit: "", words: ["extended shelf life  milk", "long life milk", "esl milk", "extended shelf life milk", "uht milk"] },
  { code: "000800", label: "White bread", unit: "", words: ["white bread", "bread", "sliced bread", "loaf of bread"] },
  { code: "000600", label: "Rye bread", unit: "", words: ["rye bread", "brown bread", "mixed bread"] },
  { code: "000700", label: "Wholemeal bread", unit: "", words: ["wholemeal bread", "whole grain bread", "wholegrain bread", "seeded bread"] },
  { code: "000900", label: "Bread roll", unit: "", words: ["bread roll", "roll", "semmel"] },
  { code: "001900", label: "Long grain rice", unit: "", words: ["long grain rice", "rice", "white rice"] },
  { code: "002000", label: "Wheat flour", unit: "", words: ["wheat flour", "flour", "plain flour"] },
  { code: "002100", label: "Pasta", unit: "", words: ["pasta", "spaghetti", "noodles"] },
  { code: "003100", label: "Roast beef", unit: "", words: ["roast beef", "beef", "goulash beef", "stewing beef"] },
  { code: "003200", label: "Beef round", unit: "", words: ["beef round", "beef schnitzel", "beef steak", "steak"] },
  { code: "003500", label: "Pork belly", unit: "", words: ["pork belly"] },
  { code: "003600", label: "Pork chops", unit: "", words: ["pork chops", "pork", "pork shoulder"] },
  { code: "003700", label: "Pork cutlet", unit: "", words: ["pork cutlet", "pork schnitzel", "schnitzel"] },
  { code: "005000", label: "Chicken breast", unit: "", words: ["chicken breast", "chicken", "chicken fillet"] },
  { code: "004800", label: "Turkey breast", unit: "", words: ["turkey breast", "turkey"] },
  { code: "002800", label: "Bacon", unit: "", words: ["bacon"] },
  { code: "004200", label: "Pork ham", unit: "", words: ["pork ham", "ham"] },
  { code: "002600", label: "Minced meat", unit: "", words: ["minced meat", "mince", "minced beef", "ground beef", "ground meat"] },
  { code: "004000", label: "Sausages", unit: "", words: ["sausages", "sausage", "frankfurters", "wiener"] },
  { code: "006500", label: "Eggs", unit: "", words: ["eggs", "egg"] },
  { code: "007300", label: "Butter", unit: "", words: ["butter"] },
  { code: "007400", label: "Margarine", unit: "", words: ["margarine"] },
  { code: "007800", label: "Olive oil", unit: "", words: ["olive oil"] },
  { code: "006700", label: "Gouda", unit: "", words: ["gouda", "cheese", "gouda cheese"] },
  { code: "006600", label: "Emmentaler", unit: "", words: ["emmentaler", "emmental", "swiss cheese"] },
  { code: "006800", label: "Hard cheese", unit: "", words: ["hard cheese", "mountain cheese"] },
  { code: "007200", label: "Mozzarella", unit: "", words: ["mozzarella"] },
  { code: "006400", label: "Yoghurt", unit: "", words: ["yoghurt", "yogurt", "plain yoghurt", "natural yoghurt"] },
  { code: "006200", label: "Yoghurt fruit flavoured", unit: "", words: ["yoghurt fruit flavoured", "fruit yoghurt", "flavoured yoghurt"] },
  { code: "005900", label: "Whipped cream", unit: "", words: ["whipped cream", "cream", "whipping cream"] },
  { code: "005800", label: "Sour cream", unit: "", words: ["sour cream"] },
  { code: "006000", label: "Curd cheese", unit: "", words: ["curd cheese", "quark"] },
  { code: "007100", label: "Fresh cream cheese", unit: "", words: ["fresh cream cheese", "cream cheese"] },
  { code: "009200", label: "Bananas", unit: "", words: ["bananas", "banana"] },
  { code: "009400", label: "Oranges", unit: "", words: ["oranges", "orange"] },
  { code: "009500", label: "Lemons", unit: "", words: ["lemons", "lemon"] },
  { code: "008500", label: "Apples", unit: "", words: ["apples", "apple"] },
  { code: "008600", label: "Pears", unit: "", words: ["pears", "pear"] },
  { code: "008900", label: "Grapes", unit: "", words: ["grapes", "grape"] },
  { code: "010490", label: "Avocado", unit: "", words: ["avocado", "avocados"] },
  { code: "010700", label: "Cauliflower", unit: "", words: ["cauliflower"] },
  { code: "010900", label: "Iceberg lettuce", unit: "", words: ["iceberg lettuce", "lettuce", "salad"] },
  { code: "010600", label: "Cucumbers", unit: "", words: ["cucumbers", "cucumber"] },
  { code: "011000", label: "Paprika", unit: "", words: ["paprika", "peppers", "bell pepper"] },
  { code: "011400", label: "Tomatoes", unit: "", words: ["tomatoes", "tomato"] },
  { code: "010500", label: "Champignons", unit: "", words: ["champignons", "mushrooms"] },
  { code: "011700", label: "Onions", unit: "", words: ["onions", "onion"] },
  { code: "011800", label: "Potatoes", unit: "", words: ["potatoes", "potato"] },
  { code: "013200", label: "Crystal sugar", unit: "", words: ["crystal sugar", "sugar", "white sugar"] },
  { code: "013000", label: "Jam", unit: "", words: ["jam", "marmalade"] },
  { code: "012500", label: "Milk chocolate", unit: "", words: ["milk chocolate", "chocolate"] },
  { code: "014300", label: "Coffee", unit: "", words: ["coffee", "coffee beans", "ground coffee"] },
  { code: "014302", label: "Instant coffee", unit: "", words: ["instant coffee"] },
  { code: "014200", label: "Tea in bags", unit: "", words: ["tea in bags", "tea", "tea bags", "teabags"] },
  { code: "014800", label: "Mineral or table water", unit: "", words: ["mineral or table water", "water", "mineral water", "bottled water"] },
  { code: "015200", label: "Orange juice", unit: "", words: ["orange juice", "juice"] },
  { code: "014900", label: "Soft drink carbonated", unit: "", words: ["soft drink carbonated", "soft drink", "lemonade", "fizzy drink"] },
  { code: "015000", label: "Cola", unit: "", words: ["cola", "coke"] },
  { code: "014000", label: "Ketchup", unit: "", words: ["ketchup"] },
  { code: "013900", label: "Mustard", unit: "", words: ["mustard"] },
  { code: "010100", label: "French fries, deep frozen", unit: "", words: ["french fries, deep frozen", "french fries", "frozen fries", "frozen chips"] },
  { code: "000100", label: "Pizza, deep frozen", unit: "", words: ["pizza, deep frozen", "pizza", "frozen pizza"] },
  { code: "005400", label: "Fresh fish", unit: "", words: ["fresh fish", "fish"] },
  { code: "005500", label: "Smoked salmon", unit: "", words: ["smoked salmon", "salmon"] },
  { code: "005100", label: "Tunafish", unit: "", words: ["tunafish", "tuna", "tuna fish"] },
  { code: "005200", label: "Codfish filet, deep frozen", unit: "", words: ["codfish filet, deep frozen", "cod", "cod fillet"] },
  { code: "014103", label: "Baby food (milk)", unit: "", words: ["baby food (milk)", "baby food", "baby milk", "infant formula"] },
  { code: "010200", label: "Potatoe chips", unit: "", words: ["potatoe chips", "crisps", "potato chips", "chips"] },
  { code: "001000", label: "Scone, handmade", unit: "", words: ["scone, handmade"] },
  { code: "001110", label: "Lye bun", unit: "", words: ["lye bun"] },
  { code: "001500", label: "Butter biscuits", unit: "", words: ["butter biscuits"] },
  { code: "001600", label: "Wafers with hazelnut cream", unit: "", words: ["wafers with hazelnut cream"] },
  { code: "001700", label: "Salty sticks", unit: "", words: ["salty sticks"] },
  { code: "002300", label: "Nut cake", unit: "", words: ["nut cake"] },
  { code: "002400", label: "Curd cheese cake", unit: "", words: ["curd cheese cake"] },
  { code: "001200", label: "Ready-made dough", unit: "", words: ["ready-made dough"] },
  { code: "003300", label: "Beef shoulder", unit: "", words: ["beef shoulder"] },
  { code: "004600", label: "Salami", unit: "", words: ["salami"] },
  { code: "004100", label: "Dry sausage", unit: "", words: ["dry sausage"] },
  { code: "004300", label: "Turkey sausage", unit: "", words: ["turkey sausage"] },
  { code: "004400", label: "Pork sausage", unit: "", words: ["pork sausage"] },
  { code: "004900", label: "Breaded chicken meat, deep frozen", unit: "", words: ["breaded chicken meat, deep frozen"] },
  { code: "005300", label: "Fish fingers, deep frozen", unit: "", words: ["fish fingers, deep frozen"] },
  { code: "005700", label: "Milk shake", unit: "", words: ["milk shake"] },
  { code: "008440", label: "Berries", unit: "", words: ["berries"] },
  { code: "008100", label: "Raisins", unit: "", words: ["raisins"] },
  { code: "008000", label: "Peanuts salted", unit: "", words: ["peanuts salted"] },
  { code: "009900", label: "Mixed vegetables, deep frozen", unit: "", words: ["mixed vegetables, deep frozen"] },
  { code: "010000", label: "Spinach, deep frozen", unit: "", words: ["spinach, deep frozen"] },
  { code: "012550", label: "Chocolate box", unit: "", words: ["chocolate box"] },
  { code: "012600", label: "Chocolate bar", unit: "", words: ["chocolate bar"] },
  { code: "014500", label: "Cocoa instant drink", unit: "", words: ["cocoa instant drink"] },
  { code: "012700", label: "Chewing gum", unit: "", words: ["chewing gum"] },
  { code: "012800", label: "Fruit drops/ -jelly", unit: "", words: ["fruit drops/ -jelly"] },
  { code: "000200", label: "Yeast dumpling, deep frozen", unit: "", words: ["yeast dumpling, deep frozen"] },
  { code: "003000", label: "Beef goulash canned", unit: "", words: ["beef goulash canned"] },
  { code: "014100", label: "Vinegar", unit: "", words: ["vinegar"] },
  { code: "013800", label: "Red pepper", unit: "", words: ["red pepper"] },
  { code: "014301", label: "Coffeepads /-caps", unit: "", words: ["coffeepads /-caps"] },
];

// ---------- reading the files (pure) ----------

export interface MonthPoint {
  /** "2026-09" */
  month: string;
  median: number;
  mean: number | null;
  p25: number | null;
  p75: number | null;
}
export interface Product {
  id: string;
  title_en: string;
  title_de: string;
  /** Months with a usable median, oldest first. */
  points: MonthPoint[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The month ("YYYY-MM") of a millisecond timestamp. */
export function monthOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

/** Read one item file. Throws a SourceError if it has changed shape; months whose median is "NA" are dropped. */
export function parseProduct(json: any): Product {
  const price = json?.price;
  if (!json || typeof json.productId !== "string" || !price || !Array.isArray(price.medianData)) {
    throw new SourceError("The Statistik Austria Preisradar file has changed shape: expected productId and price.medianData.");
  }
  const byMonth = new Map<string, MonthPoint>();
  for (const row of price.medianData as unknown[]) {
    if (!Array.isArray(row)) continue;
    const ts = num(row[0]);
    const median = num(row[1]);
    if (ts === null || median === null || !(median > 0)) continue;
    byMonth.set(monthOf(ts), { month: monthOf(ts), median, mean: null, p25: null, p75: null });
  }
  for (const row of (Array.isArray(price.meanData) ? price.meanData : []) as unknown[]) {
    if (!Array.isArray(row)) continue;
    const p = byMonth.get(monthOf(Number(row[0])));
    if (p) p.mean = num(row[1]);
  }
  for (const row of (Array.isArray(price.rangeData) ? price.rangeData : []) as unknown[]) {
    if (!Array.isArray(row)) continue;
    const p = byMonth.get(monthOf(Number(row[0])));
    if (p) {
      p.p25 = num(row[1]);
      p.p75 = num(row[2]);
    }
  }
  const points = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { id: json.productId, title_en: String(json.productTitle_en ?? ""), title_de: String(json.productTitle_de ?? ""), points };
}

/** "Long grain rice (1000 gram)" -> { name: "Long grain rice", pack: "1000 gram" }. */
export function splitTitle(title: string): { name: string; pack: string | null } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(title.trim());
  return m ? { name: m[1].trim(), pack: m[2].trim() } : { name: title.trim(), pack: null };
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
const row = (item: string, v: number): DailyRow => ({ area: "ALL", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });

/** Pure: library rows from the parsed items. Per item priced in the newest month: the median (item = id), the month before (id.m1) and
 *  the same month a year earlier (id.y1). Each row is one published figure: n is NO_COUNT and the range fields repeat the figure. */
export function harvestFromProducts(products: Product[]): HarvestResult {
  let month: string | null = null;
  for (const p of products) {
    const m = p.points[p.points.length - 1]?.month;
    if (m && (!month || m > month)) month = m;
  }
  if (!month) throw new SourceError("The Statistik Austria Preisradar files hold no usable price.");
  const prev = shiftMonth(month, -1)!;
  const year = shiftMonth(month, -12)!;
  const rows: DailyRow[] = [];
  for (const p of products) {
    const at = (m: string) => p.points.find((x) => x.month === m)?.median;
    const now = at(month);
    if (now === undefined) continue;
    rows.push(row(p.id, now));
    const a = at(prev);
    if (a !== undefined) rows.push(row(p.id + ROW_PREV, a));
    const b = at(year);
    if (b !== undefined) rows.push(row(p.id + ROW_YEAR, b));
  }
  if (rows.length < 60) throw new SourceError(`Only ${rows.length} Preisradar rows found for ${month}; refusing to store them.`);
  return {
    date: `${month}-01`,
    currency: "EUR",
    unit: "per item as stated (see item.unit)",
    rows,
    note: `STATISTIK AUSTRIA Preisradar, monthly median scanner-data prices for ${monthWords(month)}, with the previous month and the same month a year earlier. Published medians, not counts of records (no record count is published).`,
  };
}

const BASE = "https://www.statistik.at/preisradar/data/ep/";
const HEADERS = { accept: "application/json", "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export async function fetchProduct(id: string, load: (url: string) => Promise<any> = (u) => fetchJson(u, { headers: HEADERS }, 9000)): Promise<Product> {
  return parseProduct(await retryOnce(() => load(`${BASE}${id}.json`)));
}

export async function atHarvest(o: { load?: (url: string) => Promise<any>; concurrency?: number } = {}): Promise<HarvestResult> {
  const ids = ITEMS.map((i) => i.code);
  const products: Product[] = [];
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        products.push(await fetchProduct(id, o.load));
      } catch {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 6 }, worker));
  if (products.length < 60) throw new SourceError(`Only ${products.length} of ${ids.length} Preisradar files could be read (${failed.length} failed).`);
  return harvestFromProducts(products);
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const eur = (v: number) => `EUR ${v.toFixed(2)}`;

export function change(from: number | null, to: number): { change_percent: number; change_amount: number } | null {
  if (from === null || !(from > 0)) return null;
  return { change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: roundTo(to - from, 3) };
}

const AT_WORDS = new Set(["at", "austria", "aut", "national", "nationwide", "all", "whole country", "osterreich", "österreich"]);

export function atMethod(): string {
  return (
    "STATISTIK AUSTRIA's Preisradar publishes, for 100 standard food items and every month, the median price computed from retailers' scanner (till) data after discounts. " +
    "ProofPrice returns the published median for the latest month unchanged, with the mean and the 25th-75th percentile range the publisher also gives, the month before, the same month a year earlier and the changes we calculate from them. " +
    "The range is the 25th to 75th percentile, not the 10th to 90th, and no count of sales is published. These are statistics compiled from scanner data, not receipts."
  );
}

export interface AtQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function atAnswer(product: Product | null, def: ItemDef | null, related: ItemDef[], q: AtQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "AT", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "median" as const, currency: "EUR", method: atMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !AT_WORDS.has(q.region.trim().toLowerCase())
      ? `STATISTIK AUSTRIA publishes national figures only, so the region "${q.region}" was ignored and the figure is for the whole of Austria.`
      : undefined;
  const last = product?.points[product.points.length - 1];

  if (!def || !product || !last) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `STATISTIK AUSTRIA's Preisradar holds no price for "${def.label}".` : `STATISTIK AUSTRIA's Preisradar has no standard item for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 100), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const month = last.month;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const behind = monthsBehind(month, q.today ?? new Date());
  const at = (mm: string) => product.points.find((p) => p.month === mm)?.median ?? null;
  const yearMonth = shiftMonth(month, -12)!;
  const prevMonth = shiftMonth(month, -1)!;
  const yearAgo = at(yearMonth);
  const previous = at(prevMonth);
  const yoy = change(yearAgo, last.median);
  const mom = change(previous, last.median);
  const { name, pack } = splitTitle(product.title_en);
  const unit = pack ? `per ${pack}` : "per item as defined by STATISTIK AUSTRIA (see item.definition)";
  const definition = product.title_en || def.label;
  const notes: string[] = [];
  if (behind >= 4) notes.push(`Old data: the newest figure for this item is for ${monthWords(month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Austria",
    item: { code: product.id, definition, definition_de: product.title_de || undefined, unit, asked_for: q.item },
    what_this_is: "Monthly median price from retail scanner (till) data after discounts, published by STATISTIK AUSTRIA in its Preisradar. Not a receipt and not the price at any one shop.",
    reference_month: month,
    reference_month_label: monthWords(month),
    mean: last.mean,
    interquartile_range: last.p25 !== null && last.p75 !== null ? { p25: last.p25, p75: last.p75, note: "25th to 75th percentile of the scanner prices, as published (not p10-p90)" } : null,
    change_on_year_earlier: yoy && yearAgo !== null ? { reference_month: yearMonth, value: yearAgo, ...yoy } : null,
    change_on_previous_month: mom && previous !== null ? { reference_month: prevMonth, value: previous, ...mom } : null,
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label })),
    dataset: { title: "Preisradar (STATISTIK AUSTRIA)", url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: last.median,
    unit,
    period: { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` },
    reference_period: month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Austria the median scanner-data price of "${name}"${pack ? ` (${pack})` : ""} was ${eur(v)} in ${monthWords(month)} (STATISTIK AUSTRIA Preisradar, not receipts).` +
      (yoy && yearAgo !== null
        ? yoy.change_percent === 0
          ? ` That is unchanged from ${monthWords(yearMonth)} (${eur(yearAgo)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${eur(yearAgo)} in ${monthWords(yearMonth)}).`
        : " No price for the same month a year earlier is available."),
    extra,
  });
}

// ---------- the request ----------

export async function atGroceryPrices(input: AtQuery, o: { load?: (url: string) => Promise<any> } = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  const product = m.primary ? await fetchProduct(m.primary.code, o.load) : null;
  return atAnswer(product, m.primary, m.related, input);
}

/** Where a request lives in the library, without asking STATISTIK AUSTRIA. */
export function atHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const m = p.item ? matchItem(ITEMS, p.item).primary : null;
  return m ? { area: "ALL", item: m.code, label: m.label } : null;
}
