// Bulgaria: average prices households paid for main foods, from the National Statistical Institute (NSI), Household Budget Survey,
// table "Average prices and purchased quantities of main food average per household" (HH_6.1, EUR, English):
//   https://www.nsi.bg/sites/default/files/files/data/timeseries/HH_6.1_EUR_en.xlsx   (34 KB, plain GET works, checked 2026-11-10)
// Format checked live on 2026-11-10: one sheet. Row 3 (0-based 2) holds the years in every second column from column C (2008 ... 2025);
// each year spans two columns: "quantity" (per household, in the unit of column B) and "average price - EUR". Column A = food name
// (sub-items indented by two spaces; group headers such as "Bread" have no unit and no values), column B = unit (kg, litre, number).
// These are unit values from the household budget survey (what households reported paying per unit), national, annual. NSI gives no
// record count, so this is an official statistic: value + measure "average", range fields null, sample_size null.
// Licence: NSI licence v2.0 allows reuse "including for commercial purposes" with the author named each time, but "You may not
// disseminate derivative or collective works" (clause 2.1.1): the figures are passed on unchanged (no calculated changes) and the source
// is treated as free tier only (Licence cleared = Unclear in the Source Pipeline).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { readXlsx, Cell } from "../../categories/rent/xlsx";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "bg-nsi-groceries",
  country: "BG (Bulgaria)",
  category: "groceries (average prices households paid for main foods)",
  name: "Average prices and purchased quantities of main food per household (Household Budget Survey, table HH_6.1)",
  publisher: "National Statistical Institute of Bulgaria (NSI)",
  what_is_recorded:
    "For about 85 main foods and drinks, the national average price per kg, litre or item that households reported paying in the Household Budget Survey " +
    "(EUR), with the quantity bought per household in the year. One published average per food and year; never an individual household or shop.",
  price_type: "official_statistic",
  freshness: "Annual: the 2025 figures are the newest published (checked 10 November 2026)",
  licence:
    "NSI licence v2.0: reuse allowed, including for commercial purposes, provided the author is named with each use; derivative or collective works may not be disseminated (clause 2.1.1). " +
    "ProofPrice passes the published figures on unchanged.",
  licence_url: "https://www.nsi.bg/en/pages/license-to-use-statistical-information-produced-and-disseminated-by-the-national-statistical-institute-485",
  attribution: "Source: National Statistical Institute of Bulgaria (NSI), Household Budget Survey, www.nsi.bg. Figures are passed on as published.",
  homepage: "https://www.nsi.bg/en/statistical-data/248/793",
  limits:
    "National annual averages only (no regions, no months). They are what households reported paying per unit in a survey, not shelf prices and not receipts. " +
    "NSI does not say how many households stand behind an average.",
};

export const XLSX_URL = "https://www.nsi.bg/sites/default/files/files/data/timeseries/HH_6.1_EUR_en.xlsx";

/** `code` is the food name exactly as the NSI file spells it (trimmed); `label` is what answers show. */
export const ITEMS: ItemDef[] = [
  { code: "Rice", label: "Rice", unit: "per kg", words: ["rice"] },
  { code: "Flour", label: "Flour", unit: "per kg", words: ["flour", "wheat flour"] },
  { code: "White bread", label: "White bread", unit: "per kg", words: ["bread", "white bread", "loaf"] },
  { code: "Dobrudzha bread", label: "Dobrudzha bread", unit: "per kg", words: ["dobrudzha bread"] },
  { code: "Pasta products", label: "Pasta products", unit: "per kg", words: ["pasta", "spaghetti", "noodles"] },
  { code: "Pork", label: "Pork", unit: "per kg", words: ["pork"] },
  { code: "Lamb", label: "Lamb", unit: "per kg", words: ["lamb"] },
  { code: "Minced meat", label: "Minced meat", unit: "per kg", words: ["minced meat", "mince", "ground meat", "beef"] },
  { code: "Poultry meat", label: "Poultry meat", unit: "per kg", words: ["chicken", "poultry", "poultry meat", "turkey"] },
  { code: "Bacon", label: "Bacon", unit: "per kg", words: ["bacon"] },
  { code: "Dry meat", label: "Dry meat", unit: "per kg", words: ["dry meat", "salami", "cured meat"] },
  { code: "Perishable sausages", label: "Perishable sausages", unit: "per kg", words: ["sausage", "sausages", "perishable sausages"] },
  { code: "Non-perishable sausages", label: "Non-perishable sausages", unit: "per kg", words: ["non perishable sausages"] },
  { code: "Fresh and frozen fish", label: "Fresh and frozen fish", unit: "per kg", words: ["fish", "fresh fish", "frozen fish"] },
  { code: "Canned fish and seafood", label: "Canned fish and seafood", unit: "per kg", words: ["canned fish", "tuna", "seafood"] },
  { code: "Milk", label: "Milk", unit: "per litre", words: ["milk", "fresh milk", "cow milk", "whole milk"] },
  { code: "Yoghurt", label: "Yoghurt", unit: "per kg", words: ["yoghurt", "yogurt"] },
  { code: "White cheese", label: "White cheese (sirene)", unit: "per kg", words: ["white cheese", "feta", "sirene", "cheese"] },
  { code: "Yellow cheese", label: "Yellow cheese (kashkaval)", unit: "per kg", words: ["yellow cheese", "kashkaval", "hard cheese"] },
  { code: "Eggs", label: "Eggs", unit: "per egg", words: ["eggs", "egg"] },
  { code: "Sunflower oil", label: "Sunflower oil", unit: "per litre", words: ["sunflower oil", "cooking oil", "vegetable oil", "oil"] },
  { code: "Margarine", label: "Margarine", unit: "per kg", words: ["margarine"] },
  { code: "Butter", label: "Butter", unit: "per kg", words: ["butter"] },
  { code: "Lard", label: "Lard", unit: "per kg", words: ["lard"] },
  { code: "Apples", label: "Apples", unit: "per kg", words: ["apples", "apple"] },
  { code: "Pears", label: "Pears", unit: "per kg", words: ["pears", "pear"] },
  { code: "Plums", label: "Plums", unit: "per kg", words: ["plums", "plum"] },
  { code: "Peaches and apricots", label: "Peaches and apricots", unit: "per kg", words: ["peaches", "apricots", "peach"] },
  { code: "Strawberries and raspberries", label: "Strawberries and raspberries", unit: "per kg", words: ["strawberries", "raspberries"] },
  { code: "Grapes", label: "Grapes", unit: "per kg", words: ["grapes"] },
  { code: "Citros fruits", label: "Citrus fruits", unit: "per kg", words: ["citrus", "citrus fruits", "oranges", "lemons", "orange", "lemon"] },
  { code: "Bananas", label: "Bananas", unit: "per kg", words: ["bananas", "banana"] },
  { code: "Watermelons and melons", label: "Watermelons and melons", unit: "per kg", words: ["watermelon", "watermelons", "melon", "melons"] },
  { code: "Nuts", label: "Nuts", unit: "per kg", words: ["nuts", "walnuts"] },
  { code: "Juices, syrups and nectars", label: "Juices, syrups and nectars", unit: "per kg", words: ["juice", "orange juice", "nectar"] },
  { code: "Jam, preserves and marmalade", label: "Jam, preserves and marmalade", unit: "per kg", words: ["jam", "marmalade"] },
  { code: "Tomatoes", label: "Tomatoes", unit: "per kg", words: ["tomatoes", "tomato"] },
  { code: "Cucumbers", label: "Cucumbers", unit: "per kg", words: ["cucumbers", "cucumber"] },
  { code: "Cabbage", label: "Cabbage", unit: "per kg", words: ["cabbage"] },
  { code: "Peppers", label: "Peppers", unit: "per kg", words: ["peppers", "pepper"] },
  { code: "Onions", label: "Onions", unit: "per kg", words: ["onions", "onion"] },
  { code: "Garlic", label: "Garlic", unit: "per kg", words: ["garlic"] },
  { code: "Dry beans", label: "Dry beans", unit: "per kg", words: ["beans", "dry beans"] },
  { code: "Lentil", label: "Lentils", unit: "per kg", words: ["lentils", "lentil"] },
  { code: "Fresh mushrooms", label: "Fresh mushrooms", unit: "per kg", words: ["mushrooms", "fresh mushrooms"] },
  { code: "Potatoes", label: "Potatoes", unit: "per kg", words: ["potatoes", "potato"] },
  { code: "Sugar", label: "Sugar", unit: "per kg", words: ["sugar"] },
  { code: "Chocolate products", label: "Chocolate products", unit: "per kg", words: ["chocolate"] },
  { code: "Honey", label: "Honey", unit: "per kg", words: ["honey"] },
  { code: "Coffee", label: "Coffee", unit: "per kg", words: ["coffee"] },
  { code: "Tea", label: "Tea", unit: "per kg", words: ["tea"] },
  { code: "Salt", label: "Salt", unit: "per kg", words: ["salt"] },
  { code: "Vinegar", label: "Vinegar", unit: "per litre", words: ["vinegar"] },
  { code: "Soft drinks", label: "Soft drinks", unit: "per litre", words: ["soft drink", "soft drinks", "cola", "soda"] },
  { code: "Mineral water", label: "Mineral water", unit: "per litre", words: ["mineral water", "water", "bottled water"] },
  { code: "Beer", label: "Beer", unit: "per litre", words: ["beer", "lager"] },
  { code: "Wine", label: "Wine", unit: "per litre", words: ["wine"] },
  { code: "Spirits", label: "Spirits", unit: "per litre", words: ["spirits", "vodka", "whisky"] },
  { code: "Brandy", label: "Brandy (rakia)", unit: "per litre", words: ["brandy", "rakia"] },
];

// ---------- reading the file (pure) ----------

export interface YearValue {
  year: number;
  /** Average price in EUR per unit. */
  price: number;
  /** Quantity bought per household in the year, in the file's unit; null when empty. */
  quantity: number | null;
}

export interface NsiTable {
  title: string;
  years: number[];
  /** Food name (trimmed) -> unit as written in the file and its yearly values, oldest first. */
  foods: Map<string, { unit: string; series: YearValue[] }>;
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

/** Parse the workbook bytes. Fails loudly (SourceError) when the layout is not the one we checked. */
export function parseNsi(buf: Buffer | Uint8Array): NsiTable {
  const sheets = readXlsx(Buffer.from(buf));
  const rows = sheets[0]?.rows;
  if (!rows || rows.length < 10) throw new SourceError("The NSI price file has changed shape: no sheet rows were found.");
  const title = String(rows[0]?.[0] ?? "").trim();
  const yearRowIndex = rows.findIndex((r) => r.filter((c) => typeof c === "number" && c >= 1990 && c <= 2100).length >= 5);
  if (yearRowIndex < 0) throw new SourceError("The NSI price file has changed shape: the year row was not found.");
  const yearCols: { year: number; col: number }[] = [];
  rows[yearRowIndex].forEach((c, col) => {
    if (typeof c === "number" && c >= 1990 && c <= 2100) yearCols.push({ year: c, col });
  });
  // The two header rows under the years must say "quantity" and "average ... price" so a changed order is noticed.
  const head = rows[yearRowIndex + 1] ?? [];
  const head2 = rows[yearRowIndex + 2] ?? [];
  const first = yearCols[0].col;
  if (!/quantity/i.test(String(head[first] ?? "")) || !/average/i.test(String(head[first + 1] ?? "")) || !/price/i.test(String(head2[first + 1] ?? ""))) {
    throw new SourceError("The NSI price file has changed shape: the quantity / average price columns moved.");
  }
  const foods = new Map<string, { unit: string; series: YearValue[] }>();
  for (const r of rows.slice(yearRowIndex + 3)) {
    const name = typeof r[0] === "string" ? r[0].trim() : "";
    const unit = typeof r[1] === "string" ? r[1].trim() : "";
    if (!name || !unit) continue; // group headers and blank rows
    const series: YearValue[] = [];
    for (const { year, col } of yearCols) {
      const price = num(r[col + 1]);
      if (price != null && price > 0) series.push({ year, price, quantity: num(r[col]) });
    }
    if (series.length) foods.set(name, { unit, series });
  }
  if (foods.size < 40) throw new SourceError("The NSI price file has changed shape: too few food rows were found.");
  return { title, years: yearCols.map((y) => y.year), foods };
}

export interface NsiReading {
  code: string;
  series: YearValue[];
  latest: YearValue;
  fileUnit: string;
  title: string;
  tableLatestYear: number;
}

export function readFood(t: NsiTable, code: string): NsiReading | null {
  const f = t.foods.get(code);
  if (!f) return null;
  const latest = f.series[f.series.length - 1];
  const tableLatestYear = Math.max(...[...t.foods.values()].map((x) => x.series[x.series.length - 1].year));
  return { code, series: f.series, latest, fileUnit: f.unit, title: t.title, tableLatestYear };
}

// ---------- the answer (pure) ----------

const eur = (v: number) => `EUR ${v.toFixed(2)}`;

export function nsiMethod(): string {
  return (
    "The National Statistical Institute of Bulgaria (NSI) publishes, once a year, the national average price that households reported paying for about 85 main foods and drinks in its Household Budget Survey, " +
    "with the quantity bought per household (table HH_6.1). ProofPrice returns the published average for the food's latest year, unchanged, and the published averages of the earlier years. " +
    "No range is calculated: NSI gives one average and does not say how many households are behind it. These are survey unit values, not shelf prices and not receipts."
  );
}

export interface NsiQuery {
  item: string;
  region?: string;
  baseUrl?: string;
}

const BULGARIA_WORDS = new Set(["bg", "bulgaria", "bgr", "national", "nationwide", "all", "whole country"]);

export function nsiAnswer(reading: NsiReading | null, def: ItemDef | null, related: ItemDef[], q: NsiQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "BG", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", method: nsiMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !BULGARIA_WORDS.has(q.region.trim().toLowerCase())
      ? `NSI publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Bulgaria.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `The NSI table holds no price for "${def.label}".` : `The NSI household food price table has no food matching "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const r = reading;
  const y = String(r.latest.year);
  const behind = new Date().getUTCFullYear() - r.latest.year;
  const notes: string[] = [];
  if (r.latest.year < r.tableLatestYear) notes.push(`NSI has no price for this food in ${r.tableLatestYear}; this is its latest available year.`);
  if (behind >= 3) notes.push(`Old data: the newest price NSI holds for this food is from ${y}.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Bulgaria",
    item: { definition: def.label, unit: def.unit, nsi_name: r.code, asked_for: q.item },
    what_this_is:
      "Average price per unit that Bulgarian households reported paying for this food in the NSI Household Budget Survey, for the whole year. Not a shelf price, not a receipt and not the price at any one shop.",
    reference_year: r.latest.year,
    quantity_bought_per_household: r.latest.quantity != null ? { year: r.latest.year, amount: r.latest.quantity, unit: r.fileUnit === "number" ? "items" : r.fileUnit } : null,
    published_by_year: r.series.slice(-8).map((s) => ({ year: s.year, average_price_eur: s.price })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    dataset: { code: "HH_6.1 (EUR, English)", title: r.title || null, latest_year_in_file: r.tableLatestYear, url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: r.latest.price,
    unit: def.unit,
    period: { from: `${y}-01-01`, to: `${y}-12-31` },
    reference_period: y,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Bulgaria households paid on average ${eur(v)} ${def.unit} for "${def.label}" in ${y} ` +
      `(NSI Household Budget Survey; an annual national average, not a shelf price or receipt).`,
    extra,
  });
}

// ---------- the request ----------

export interface NsiOptions {
  /** Replace the download (tests): returns the raw file bytes. */
  loader?: () => Promise<ArrayBuffer | Uint8Array>;
  timeoutMs?: number;
}

async function download(timeoutMs: number): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(XLSX_URL, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, XLSX_URL, res.status);
    return await res.arrayBuffer();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", XLSX_URL);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function bgNsiGroceries(input: NsiQuery, o: NsiOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday food such as 'milk', 'bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return nsiAnswer(null, null, [], input);
  const bytes = await (o.loader ? o.loader() : download(o.timeoutMs ?? 20000));
  const table = parseNsi(Buffer.from(bytes as ArrayBuffer));
  return nsiAnswer(readFood(table, m.primary.code), m.primary, m.related, input);
}

// ---------- daily copy (stale-if-error) ----------
// The collector reads the same file once a day and keeps the newest year of every mapped food (one published average each, n is NO_COUNT,
// dated by the last day of the reference year).

export const NATIONAL_AREA = "ALL";

export function harvestRows(t: NsiTable): HarvestResult {
  const readings = ITEMS.map((def) => ({ def, r: readFood(t, def.code) })).filter((x): x is { def: ItemDef; r: NsiReading } => !!x.r);
  if (!readings.length) throw new SourceError("The NSI table held no price for any mapped food");
  const year = Math.max(...readings.map((x) => x.r.latest.year));
  const rows = readings
    .filter((x) => x.r.latest.year === year)
    .map((x) => {
      const v = x.r.latest.price;
      return { area: NATIONAL_AREA, item: x.def.label, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: `${year}-12-31`,
    currency: "EUR",
    unit: "per kg, litre or egg (named in the item)",
    rows,
    note: `NSI Household Budget Survey HH_6.1: national average prices households paid in ${year}, ${rows.length} foods. Published averages, no record count.`,
  };
}

export async function bgNsiHarvest(o: NsiOptions & { sleep?: (ms: number) => Promise<void> } = {}): Promise<HarvestResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bytes = await (o.loader ? o.loader() : download(o.timeoutMs ?? 60000));
      return harvestRows(parseNsi(Buffer.from(bytes as ArrayBuffer)));
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(5000 * attempt);
    }
  }
  throw last;
}

export function bgNsiHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const def = matchItem(ITEMS, p.item ?? "").primary;
  return def ? { area: NATIONAL_AREA, item: def.label, label: "Bulgaria" } : null;
}
