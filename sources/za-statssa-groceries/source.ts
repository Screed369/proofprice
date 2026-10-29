// South Africa: "CPI Average Prices" from Statistics South Africa (Stats SA, publication P0141), the monthly average retail price in rand of about
// 190 everyday goods, each in one or two pack sizes, for all urban areas. Published as one zip per month holding one .xlsx, named for the data month:
//   https://www.statssa.gov.za/timeseriesdata/Excel/P0141%20-%20CPI%20Average%20Prices%20All%20urban%20(202609).zip   (checked 2026-10-29)
// Format checked on 2026-10-29 by downloading the September 2026 file from GitHub's servers (the workspace shell cannot reach statssa.gov.za):
// one sheet "Average prices", row 1 = headers H01, H02, Old code, Old description, H03 (item code), H04 (item name), H05 ("Price (Rand)"), H06 ("monthly"),
// H07 (pack id), H08 (pack size text, e.g. "1 Kilogram", "Per Kilogram", "For 6"), then one column per month "M201701" ... "M202609".
// Values are rand (some cells are text, some numbers; empty when the item was not priced). Aug and Sep 2026 are both present.
//
// Stats SA publishes one national average per item, pack and month: no distribution and no record count. So the answer is an official statistic
// (value + measure "average", no range, sample_size null). The collector (harvest) downloads the newest file once a day and stores, for each
// item, the latest month, the month before and the same month a year earlier; requests are answered from that copy.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";
import { Cell, readWorkbook, unzip } from "./xlsx";

export const INFO: SourceInfo = {
  id: "za-statssa-groceries",
  country: "ZA (South Africa)",
  category: "groceries (monthly average retail prices of everyday goods)",
  name: "Consumer Price Index (P0141): CPI average prices, all urban areas, Stats SA",
  publisher: "Statistics South Africa (Stats SA)",
  what_is_recorded:
    "For about 190 everyday goods (food, drink, household goods), the national average retail price in rand for a stated pack size (for example 1 kg of white rice or 2 litres of milk), " +
    "as published by Stats SA with its monthly consumer price index, for all urban areas. One published average per item, pack and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly, about three weeks after the end of the month; collected into our price library every day, each answer states its reference month",
  licence:
    "Stats SA copyright with a free-use permission (not an open licence): \"Users may apply the information as they wish, provided that they acknowledge Stats SA as the source of the basic data wherever they process, apply, utilise, publish or distribute the data; and also that they specify that the relevant application and analysis (where applicable) result from their own processing of the data.\" (P0141 Consumer Price Index, August 2026, General information). Not cleared for paid use: served free.",
  licence_url: "https://www.statssa.gov.za/publications/P0141/P0141August2026.pdf",
  attribution:
    "Source: Statistics South Africa (Stats SA), Consumer Price Index P0141, CPI average prices. The figures are Stats SA's published averages; selection of items and the changes calculated from them are the result of ProofPrice's own processing of the data.",
  homepage: "https://www.statssa.gov.za/?page_id=1854&PPN=P0141",
  limits:
    "National averages for all urban areas only (no provinces or towns in this source), for Stats SA's standard items and pack sizes; the file gives no count of prices behind an average. " +
    "These are average retail prices compiled for price statistics (price collectors in shops), not receipts, and not the price at any one shop or online.",
};

// ---------- the items: everyday words -> Stats SA item code + pack size ----------
/** Make a stable key from an item code and the pack text of the file: "01141101" + "2 Litre" -> "01141101_2litre"; a comma decimal ("2,5 Kilogram") becomes a dot. */
export function itemKey(code: string, pack: string): string {
  return `${code}_${pack.toLowerCase().replace(/,/g, ".").replace(/[^a-z0-9.]+/g, "")}`;
}

/** Plain unit text from Stats SA's pack text: "1 Kilogram" -> "per 1 kilogram", "Per Kilogram" -> "per kilogram", "For 6" -> "pack of 6", "Each" -> "each". */
export function packUnit(pack: string): string {
  const p = pack.trim().replace(/,/g, ".");
  const lower = p.toLowerCase();
  if (/^each$/.test(lower) || /^1 unit$/.test(lower)) return "each";
  const f = /^for (\d+)$/.exec(lower);
  if (f) return `pack of ${f[1]}`;
  if (lower.startsWith("per ")) return lower;
  return `per ${lower}`;
}

function d(code: string, pack: string, name: string, words: string[]): ItemDef {
  return { code: itemKey(code, pack), label: `${name}, ${pack.replace(/,/g, ".")}`, unit: packUnit(pack), words };
}

// Names are Stats SA's own item names (H04) read 2026-10-29. The first definition that lists a word is the default for it.
export const ITEMS: ItemDef[] = [
  d("01111201", "1 Kilogram", "White rice", ["rice", "white rice"]),
  d("01111202", "1 Kilogram", "Basmati rice", ["basmati rice", "basmati"]),
  d("01112101", "1 Kilogram", "Cake flour", ["flour", "cake flour", "white flour"]),
  d("01112102", "2.5 Kilogram", "Bread flour", ["bread flour"]),
  d("01112601", "5 Kilogram", "Maize meal", ["maize meal", "mealie meal", "maize", "pap"]),
  d("01113101", "700 Gram", "White bread", ["bread", "white bread", "loaf of bread", "loaf", "sliced bread"]),
  d("01113102", "700 Gram", "Brown bread", ["brown bread"]),
  d("01115001", "500 Gram", "Spaghetti", ["spaghetti", "pasta"]),
  d("01115002", "500 Gram", "Macaroni", ["macaroni"]),
  d("01122101", "Per Kilogram", "Beef mince", ["beef mince", "mince", "minced beef", "ground beef", "beef"]),
  d("01122107", "Per Kilogram", "Beef rump steak", ["rump steak", "beef steak", "steak"]),
  d("01122201", "Per Kilogram", "Pork chops", ["pork chops", "pork"]),
  d("01122302", "Per Kilogram", "Mutton/Lamb loin chop", ["lamb chops", "lamb", "mutton", "lamb loin chop"]),
  d("01122401", "Per Kilogram", "Whole chicken - fresh", ["chicken", "whole chicken"]),
  d("01122402", "Per Kilogram", "Chicken portions - fresh", ["chicken portions", "chicken pieces"]),
  d("01125101", "Per Kilogram", "Sausages (beef, pork, mutton)", ["sausages", "sausage"]),
  d("01125102", "Per Kilogram", "Boerewors", ["boerewors"]),
  d("01123202", "200 Gram", "Bacon", ["bacon"]),
  d("01125103", "750 Gram", "Polony", ["polony"]),
  d("01131401", "800 Gram", "Hake - fresh or frozen", ["hake", "fish"]),
  d("01132901", "170 Gram", "Tuna - canned", ["tuna", "canned tuna"]),
  d("01141101", "1 Litre", "Full cream milk - fresh", ["milk", "full cream milk", "fresh milk", "whole milk"]),
  d("01141101", "2 Litre", "Full cream milk - fresh", ["2 litre milk", "milk 2 litre"]),
  d("01141102", "1 Litre", "Full cream milk - longlife", ["longlife milk", "uht milk", "long life milk"]),
  d("01142001", "1 Litre", "Low fat milk - fresh", ["low fat milk", "skim milk"]),
  d("01143201", "400 Gram", "Powdered milk", ["powdered milk", "milk powder"]),
  d("01145001", "Per Kilogram", "Cheddar cheese", ["cheese", "cheddar", "cheddar cheese"]),
  d("01145002", "400 Gram", "Gouda cheese", ["gouda", "gouda cheese"]),
  d("01146001", "500 Gram", "Plain yogurt", ["yogurt", "yoghurt", "plain yogurt"]),
  d("01148101", "For 18", "Eggs", ["eggs", "egg", "18 eggs"]),
  d("01148101", "For 6", "Eggs", ["6 eggs", "half dozen eggs"]),
  d("01151101", "750 Millilitre", "Sunflower-seed oil (cooking oil)", ["cooking oil", "sunflower oil", "oil", "vegetable oil"]),
  d("01151301", "500 Millilitre", "Olive oil", ["olive oil"]),
  d("01152101", "500 Gram", "Butter", ["butter"]),
  d("01153001", "500 Gram", "Margarine spread", ["margarine", "spread"]),
  d("01161101", "Each", "Avocados - fresh", ["avocado", "avocados"]),
  d("01161201", "Per Kilogram", "Bananas - fresh", ["bananas", "banana"]),
  d("01162301", "Per Kilogram", "Oranges - fresh", ["oranges", "orange"]),
  d("01163101", "Per Kilogram", "Apples - fresh", ["apples", "apple"]),
  d("01163201", "Per Kilogram", "Pears - fresh", ["pears", "pear"]),
  d("01171201", "Each", "Cabbages - fresh (green and red)", ["cabbage", "cabbages"]),
  d("01171401", "Each", "Lettuce - fresh", ["lettuce"]),
  d("01171501", "Per Bunch", "Spinach/morogo - fresh", ["spinach", "morogo"]),
  d("01172101", "Per Kilogram", "Green/red/yellow pepper - fresh", ["pepper", "peppers", "bell pepper", "green pepper"]),
  d("01172201", "Each", "Cucumber - fresh", ["cucumber"]),
  d("01172401", "Per Kilogram", "Tomatoes - fresh", ["tomatoes", "tomato"]),
  d("01172501", "Per Kilogram", "Pumpkin - fresh", ["pumpkin"]),
  d("01174101", "1 Kilogram", "Carrots - fresh", ["carrots", "carrot"]),
  d("01174201", "Per Kilogram", "Garlic", ["garlic"]),
  d("01174301", "Per Kilogram", "Onions - fresh", ["onions", "onion"]),
  d("01174501", "250 Gram", "Mushrooms - fresh", ["mushrooms", "mushroom"]),
  d("01174901", "1 Kilogram", "Beetroot - fresh", ["beetroot"]),
  d("01175101", "Per Kilogram", "Potatoes - fresh", ["potatoes", "potato"]),
  d("01175201", "Per Kilogram", "Sweet potatoes - fresh", ["sweet potatoes", "sweet potato"]),
  d("01176101", "500 Gram", "Beans - dried", ["dried beans", "beans"]),
  d("01179202", "410 Gram", "Baked beans - canned", ["baked beans"]),
  d("01181101", "1 Kilogram", "White sugar", ["sugar", "white sugar"]),
  d("01181102", "1 Kilogram", "Brown sugar", ["brown sugar"]),
  d("01183101", "500 Gram", "Honey", ["honey"]),
  d("01183901", "450 Gram", "Jam", ["jam"]),
  d("01184001", "400 Gram", "Peanut butter", ["peanut butter"]),
  d("01193101", "1 Kilogram", "Salt", ["salt"]),
  d("01193903", "700 Millilitre", "Tomato sauce", ["tomato sauce", "ketchup"]),
  d("01193904", "750 Gram", "Mayonnaise", ["mayonnaise", "mayo"]),
  d("01210001", "1 Litre", "Fruit juice", ["fruit juice", "juice", "orange juice"]),
  d("01220101", "250 Gram", "Instant coffee", ["coffee", "instant coffee"]),
  d("01230201", "125 Gram", "Ceylon/black tea", ["tea", "black tea", "tea bags", "ceylon tea"]),
  d("01230901", "100 Gram", "Rooibos tea", ["rooibos", "rooibos tea"]),
  d("01250001", "500 Millilitre", "Mineral water/spring water", ["water", "bottled water", "mineral water"]),
  d("01260002", "2 Litre", "Fizzy drinks - bottle", ["soft drink", "cold drink", "fizzy drink", "cola", "soda"]),
  d("02130101", "330 Millilitre", "Beer", ["beer", "lager"]),
  d("02121101", "750 Millilitre", "Red wine", ["wine", "red wine"]),
  d("02121102", "750 Millilitre", "White wine", ["white wine"]),
  d("02301101", "For 20", "Cigarettes", ["cigarettes", "cigarette"]),
  d("05611102", "1 Kilogram", "Washing powder", ["washing powder", "laundry powder", "detergent"]),
  d("05611103", "750 Millilitre", "Dish-washing liquid", ["dishwashing liquid", "dish washing liquid", "dish soap"]),
  d("13120201", "400 Millilitre", "Shampoo", ["shampoo"]),
  d("13120203", "150 Gram", "Bar of soap", ["soap", "bar of soap"]),
  d("13120204", "Pack Of 2 Ply 9 Rolls", "Toilet paper", ["toilet paper", "toilet roll"]),
  d("13120205", "100 Millilitre", "Toothpaste", ["toothpaste"]),
];

// ---------- the file ----------
export interface SeriesPoint {
  month: string; // YYYY-MM
  value: number;
}

const WANTED = new Set(ITEMS.map((i) => i.code));

/** Every item we list with its monthly rand prices, oldest month first. Pure: takes the rows of the "Average prices" sheet. Throws if the sheet has changed shape. */
export function parseRows(rows: Cell[][]): Map<string, SeriesPoint[]> {
  const head = rows[0] ?? [];
  const col = (n: string) => head.findIndex((c) => String(c ?? "").trim() === n);
  const [iCode, iName, iUnit, iPack] = ["H03", "H04", "H05", "H08"].map(col);
  const months: Array<{ i: number; month: string }> = [];
  head.forEach((c, i) => {
    const m = /^M(\d{4})(\d{2})$/.exec(String(c ?? "").trim());
    if (m) months.push({ i, month: `${m[1]}-${m[2]}` });
  });
  if ([iCode, iName, iUnit, iPack].some((i) => i < 0) || months.length < 12) {
    throw new SourceError("The Stats SA CPI average prices file has changed shape: expected columns H03, H04, H05, H08 and monthly columns M<YYYYMM>.");
  }
  const out = new Map<string, SeriesPoint[]>();
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n];
    if (!r || r.length === 0) continue;
    const rawCode = r[iCode];
    const code = typeof rawCode === "number" ? String(rawCode).padStart(8, "0") : String(rawCode ?? "").trim();
    const pack = String(r[iPack] ?? "").trim();
    if (!code || !pack || !/rand/i.test(String(r[iUnit] ?? ""))) continue;
    const key = itemKey(code, pack);
    if (!WANTED.has(key)) continue;
    const list = out.get(key) ?? [];
    for (const { i, month } of months) {
      const raw = r[i];
      const v = typeof raw === "number" ? raw : raw === null || raw === undefined || raw === "" ? NaN : Number(String(raw).replace(",", "."));
      if (Number.isFinite(v) && v > 0) list.push({ month, value: v });
    }
    list.sort((a, b) => a.month.localeCompare(b.month));
    out.set(key, list);
  }
  return out;
}

/** The downloaded zip (holding one .xlsx) -> items. */
export function parseZip(buf: Buffer): Map<string, SeriesPoint[]> {
  const files = unzip(buf);
  const xlsx = [...files].find(([name]) => name.toLowerCase().endsWith(".xlsx"));
  if (!xlsx) throw new SourceError("The Stats SA download holds no .xlsx workbook.");
  const sheets = readWorkbook(xlsx[1]);
  const sheet = sheets.find((s) => String(s.rows[0]?.find((c) => c === "H03") ?? "") === "H03");
  if (!sheet) throw new SourceError("The Stats SA workbook has no sheet with the expected H03 column.");
  return parseRows(sheet.rows);
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

/** The newest month in which at least 20 of our items have a price (a half-filled newest column is not used). */
export function newestMonth(series: Map<string, SeriesPoint[]>): string | null {
  const counts = new Map<string, number>();
  for (const l of series.values()) for (const p of l) counts.set(p.month, (counts.get(p.month) ?? 0) + 1);
  let best: string | null = null;
  for (const [m, c] of counts) if (c >= 20 && (!best || m > best)) best = m;
  return best;
}

const ROW_PREV = ".m1";
const ROW_YEAR = ".y1";

const row = (item: string, v: number): DailyRow => ({ area: "ALL", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });

/** Pure: library rows for the newest month. Per item: the figure (item = key), the month before (key.m1) and the same month a year earlier (key.y1),
 *  only for items priced in the newest month. Each row is one published average: n is NO_COUNT and the range fields repeat the figure. */
export function harvestFromSeries(series: Map<string, SeriesPoint[]>): HarvestResult {
  const month = newestMonth(series);
  if (!month) throw new SourceError("The Stats SA CPI average prices file holds no usable grocery price.");
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
  if (rows.length < 20) throw new SourceError(`Only ${rows.length} grocery rows found for ${month} in the Stats SA file; refusing to store it.`);
  return {
    date: `${month}-01`,
    currency: "ZAR",
    unit: "per item as stated (see item.unit)",
    rows,
    note: `Stats SA CPI average prices (P0141), all urban areas, for ${monthWords(month)}, with the previous month and the same month a year earlier. Published averages, not counts of records (no record count is published).`,
  };
}

/** The release file URLs to try, newest first: the file for this month's data, then the three months before. */
export function candidateUrls(today: Date): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, 1));
    const code = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push(`https://www.statssa.gov.za/timeseriesdata/Excel/P0141%20-%20CPI%20Average%20Prices%20All%20urban%20(${code}).zip`);
  }
  return out;
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function download(url: string, timeoutMs: number): Promise<Buffer | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/zip,*/*" }, signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`Stats SA answered HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return null; // an HTML "not found" page, not a zip
    return buf;
  } finally {
    clearTimeout(t);
  }
}

export async function zaHarvest(o: { today?: Date; load?: (url: string) => Promise<Buffer | null> } = {}): Promise<HarvestResult> {
  const load = o.load ?? ((u: string) => download(u, 60000));
  for (const url of candidateUrls(o.today ?? new Date())) {
    const buf = await load(url);
    if (buf) return harvestFromSeries(parseZip(buf));
  }
  throw new SourceError("No CPI average prices file was found at Stats SA for the last four months.");
}

// ---------- the library copy ----------

export interface ZaFigure {
  latest: number;
  previous: number | null;
  yearAgo: number | null;
}
export interface Snapshot {
  date: string; // YYYY-MM-01 of the reference month
  month: string; // YYYY-MM
  figures: Map<string, ZaFigure>;
}

export function snapshotFromRows(date: string, rows: LibraryRow[]): Snapshot {
  const raw = new Map<string, number>();
  for (const r of rows) if (r.area === "ALL") raw.set(r.item, r.median);
  const figures = new Map<string, ZaFigure>();
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

const roundTo = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const zar = (v: number) => `R${v.toFixed(2)}`;

export function change(from: number | null, to: number): { change_percent: number; change_amount: number } | null {
  if (from === null || !(from > 0)) return null;
  return { change_percent: roundTo(((to - from) / from) * 100, 1), change_amount: roundTo(to - from, 3) };
}

const ZA_WORDS = new Set(["za", "south africa", "zaf", "national", "nationwide", "all", "whole country", "all urban", "urban"]);

export function zaMethod(): string {
  return (
    "Stats SA publishes, with its monthly Consumer Price Index release, the national average retail price in rand of about 190 everyday goods in stated pack sizes, for all urban areas. " +
    "ProofPrice collects the newest file once a day and returns the published average for the latest month unchanged, with the previous month and the same month a year earlier, and the changes we calculate from them. " +
    "No range is calculated: Stats SA gives one average and no count of prices behind it. These are averages compiled for price statistics, not receipts."
  );
}

export interface ZaQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function zaAnswer(snap: Snapshot, def: ItemDef | null, related: ItemDef[], q: ZaQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "ZA", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "ZAR", method: zaMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !ZA_WORDS.has(q.region.trim().toLowerCase())
      ? `Stats SA publishes all-urban national averages only, so the region "${q.region}" was ignored and the figure is the average for urban South Africa.`
      : undefined;
  const fig = def ? snap.figures.get(def.code) : undefined;

  if (!def || !fig) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `Stats SA's latest file holds no price for "${def.label}" in ${monthWords(snap.month)}.` : `Stats SA's average prices list has no standard item for "${q.item}".`;
    const available = ITEMS.filter((x) => snap.figures.has(x.code));
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
  if (behind >= 4) notes.push(`Old data: the newest Stats SA file we hold is for ${monthWords(month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "South Africa",
    item: { code: def.code, definition: def.label, unit: def.unit, asked_for: q.item },
    what_this_is: "Monthly average retail price published by Stats SA with its consumer price index (all urban areas). Not a receipt and not the price at any one shop.",
    reference_month: month,
    reference_month_label: monthWords(month),
    change_on_year_earlier: yoy && fig.yearAgo !== null ? { reference_month: yearMonth, value: fig.yearAgo, ...yoy } : null,
    change_on_previous_month: mom && fig.previous !== null ? { reference_month: prevMonth, value: fig.previous, ...mom } : null,
    other_definitions: related.filter((x) => snap.figures.has(x.code)).map((x) => ({ item: x.words[0], definition: x.label, unit: x.unit })),
    library_snapshot_date: snap.date,
    dataset: { title: "Consumer Price Index P0141: CPI average prices, all urban", url: INFO.homepage },
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
      `In urban South Africa the average retail price of "${def.label}" was ${zar(v)} in ${monthWords(month)} (Stats SA consumer price index average prices, not receipts).` +
      (yoy && fig.yearAgo !== null
        ? yoy.change_percent === 0
          ? ` That is unchanged from ${monthWords(yearMonth)} (${zar(fig.yearAgo)}).`
          : ` That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${zar(fig.yearAgo)} in ${monthWords(yearMonth)}).`
        : " No price for the same month a year earlier is available."),
    extra,
  });
}

// ---------- the request ----------

export async function zaGroceryPrices(input: ZaQuery, o: { snapshot?: Snapshot | null } = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'bread' or 'eggs'.");
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("ProofPrice collects Stats SA's average prices daily; data appears after the next collection.");
  const m = matchItem(ITEMS, item);
  return zaAnswer(snap, m.primary, m.related, input);
}

/** Where a request lives in the library, without asking Stats SA. */
export function zaHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const m = p.item ? matchItem(ITEMS, p.item).primary : null;
  return m ? { area: "ALL", item: m.code, label: m.label } : null;
}
