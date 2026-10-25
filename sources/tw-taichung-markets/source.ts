// Taiwan, Taichung City Government: "daily vegetable and fruit price list of the city's public retail markets" (data.gov.tw dataset 84539).
// One JSON file (about 5 MB, refreshed daily, a rolling year): one object per market and visit day, with a Chinese-named column per product
// (about 60 vegetables, fruit, fish, pork, beef, poultry and eggs); the value is the market's average posted price in NT$ per catty (斤, 600 g),
// "0" meaning no price that day. We never read the file per request: the daily collector (harvest) keeps the last 14 days of market-day prices and
// stores one aggregate per product in the price library; requests are answered from there. POSTED market prices, not receipts. Aggregates only.
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "tw-taichung-markets",
  country: "Taiwan",
  category: "groceries (posted prices in the public retail markets of Taichung City)",
  name: "Taichung public retail market daily vegetable and fruit price list",
  publisher: "Taichung City Government (臺中市政府), via data.gov.tw (dataset 84539)",
  what_is_recorded:
    "The average price the city's price collectors recorded for one product (vegetable, fruit, fish, pork, beef, poultry or eggs) in one public retail market on one day, in New Taiwan dollars per catty (斤, 600 g).",
  price_type: "posted_price",
  freshness: "Daily",
  licence: "Taiwan Open Government Data License v1.0 (政府資料開放授權條款-第1版: any purpose including commercial, attribution required, compatible with CC BY 4.0)",
  licence_url: "https://data.gov.tw/license",
  attribution:
    "臺中市政府 2026 臺中市政府公有零售市場每日蔬果價格表; 此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出, https://data.gov.tw/license. " +
    "Accessed by ProofPrice; changed by ProofPrice: market-day prices of the last 14 days converted from NT$ per catty (600 g) to NT$ per kg, reported as median and 10th to 90th percentile. Not endorsed by Taichung City Government.",
  homepage: "https://data.gov.tw/en/datasets/84539",
  limits:
    "Posted prices that city collectors recorded in 13 public retail markets of one city (Taichung), not receipts and not what one shopper paid; not a national figure. " +
    "n is the number of market-day averages over the last 14 days of data (5 or more needed). Published per catty (斤, 600 g); we convert at 1 catty = 0.6 kg. " +
    "A price more than 4 times above or below the product's median is dropped as an entry error. A product with no price that day is left out.",
};

export const FILE_URL = "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=495aff49-3547-4055-aacd-f0781c6f733e";
export const WINDOW_DAYS = 14; // market-day prices from the newest 14 days of data
export const OUTLIER_FACTOR = 4;
export const KG_PER_CATTY = 0.6;
export const MAX_AGE_DAYS = 60; // a file whose newest day is older than this is not collected (the publisher stopped updating)
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
const MARKET = "市場名稱", VISIT = "訪價日期";

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** "20261022" to "2026-10-22", or "" when it is not a valid date. */
export function isoDate(raw: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return "";
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(d + "T00:00:00Z")) || isoOf(dayNumber(d)) !== d ? "" : d;
}

export interface Rec { date: string; item: string; price: number }

export interface Parsed { recs: Rec[]; newest: string; rows: number; markets: number }

/** Reads the publisher's JSON array. Keeps the product price (NT$ per kg) of every market and day within WINDOW_DAYS of the newest day. */
export function parseMarkets(data: unknown): Parsed {
  if (!Array.isArray(data) || !data.length) throw new SourceError("Taichung price file is empty or not a list (layout changed?)");
  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== "object" || !(MARKET in first) || !(VISIT in first)) {
    throw new SourceError(`Taichung price file has a new layout: columns ${MARKET} / ${VISIT} are missing (found: ${Object.keys(first ?? {}).slice(0, 6).join(", ")})`);
  }
  let newest = "";
  for (const r of data as Record<string, unknown>[]) {
    const d = isoDate(r[VISIT]);
    if (d > newest) newest = d;
  }
  if (!newest) throw new SourceError("Taichung price file holds no valid visit dates");
  const cutoff = dayNumber(newest) - (WINDOW_DAYS - 1);
  const recs: Rec[] = [];
  const markets = new Set<string>();
  for (const r of data as Record<string, unknown>[]) {
    const date = isoDate(r[VISIT]);
    if (!date || dayNumber(date) < cutoff) continue;
    markets.add(String(r[MARKET] ?? ""));
    for (const [k, v] of Object.entries(r)) {
      if (k === MARKET || k === VISIT) continue;
      const price = Number(v);
      if (!(price > 0) || !Number.isFinite(price)) continue; // "0" = no price that day
      recs.push({ date, item: k.trim(), price: Math.round((price / KG_PER_CATTY) * 100) / 100 });
    }
  }
  return { recs, newest, rows: data.length, markets: markets.size };
}

export interface Built { rows: DailyRow[]; items: number; dropped: number }

/** One library row per product (area ALL): median and percentiles of the market-day prices, outliers dropped, 5 or more needed. */
export function buildRows(recs: Rec[]): Built {
  const per = new Map<string, number[]>();
  for (const r of recs) {
    const a = per.get(r.item);
    if (a) a.push(r.price); else per.set(r.item, [r.price]);
  }
  const med = new Map<string, number>();
  for (const [k, p] of per) {
    const s = [...p].sort((a, b) => a - b);
    med.set(k, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  let dropped = 0;
  const keep: { area: string; item: string; price: number }[] = [];
  for (const r of recs) {
    const m = med.get(r.item)!;
    if (r.price > m * OUTLIER_FACTOR || r.price < m / OUTLIER_FACTOR) { dropped++; continue; }
    keep.push({ area: NATIONAL, item: r.item, price: r.price });
  }
  const rows = aggregateDaily(keep, false).filter((r) => r.n >= MIN_PUBLISH);
  return { rows, items: rows.length, dropped };
}

export async function taichungHarvest(): Promise<HarvestResult> {
  const res = await fetch(FILE_URL, { headers: UA, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new SourceError(`Taichung price file returned HTTP ${res.status}`);
  let data: unknown;
  try { data = JSON.parse(await res.text()); } catch { throw new SourceError("Taichung price file is not valid JSON"); }
  const p = parseMarkets(data);
  const age = dayNumber(new Date().toISOString().slice(0, 10)) - dayNumber(p.newest);
  if (age > MAX_AGE_DAYS) throw new SourceError(`Taichung price file has not been updated since ${p.newest} (${age} days); not collected`);
  const b = buildRows(p.recs);
  if (!b.rows.length) throw new SourceError(`Taichung price file held no product with 5 or more market-day prices (${p.rows} rows read)`);
  return {
    date: p.newest,
    currency: "TWD",
    unit: "per kg",
    rows: b.rows,
    note: `${p.rows} rows read, newest day ${p.newest}; ${p.markets} markets in the last ${WINDOW_DAYS} days, ${b.items} products; ${b.dropped} outlier prices dropped.`,
  };
}

// ---------- matching (Chinese product names; English words through a gloss; order = preference when several match) ----------
export const GLOSS: [string, string][] = [
  ["雞蛋", "egg eggs chicken egg hen"], ["鴨蛋", "duck egg eggs"],
  ["里肌肉", "pork loin tenderloin"], ["後腿肉", "pork leg ham"], ["五花肉", "pork belly streaky"],
  ["牛腱(冷凍牛肉)", "beef shank frozen"], ["腿肉(冷凍牛肉)", "beef leg frozen"], ["腩肉(冷凍牛肉)", "beef flank brisket frozen"],
  ["肉雞", "chicken broiler"], ["土雞", "chicken native free range"], ["仿雞", "chicken native imitation"], ["鴨子(土番鴨)", "duck muscovy"],
  ["甘藍（平地高麗菜）", "cabbage high lowland"], ["結球白菜(山東白)", "napa cabbage chinese"], ["青江白菜", "bok choy pak choi chinese cabbage greens"],
  ["蕹菜(空心菜)", "water spinach morning glory"], ["花椰菜", "cauliflower"], ["胡蘿蔔", "carrot"], ["蘿蔔", "radish daikon white"],
  ["洋蔥(內銷)", "onion"], ["青蔥", "spring onion scallion green onion"], ["蒜頭", "garlic"], ["絲瓜", "luffa sponge gourd loofah"],
  ["胡瓜", "cucumber"], ["花胡瓜", "cucumber flower"],
  ["小番茄_聖女", "tomato cherry"], ["小番茄_玉女", "tomato cherry"],
  ["香蕉(內銷)", "banana"], ["柳橙", "orange"], ["檸檬", "lemon"], ["西瓜(大粒)", "watermelon"], ["木瓜", "papaya"],
  ["芒果(愛文)", "mango irwin"], ["芒果", "mango"], ["鳳梨(金鑽17號)", "pineapple"], ["鳳梨(開英)", "pineapple"], ["鳳梨(四號)", "pineapple"],
  ["火龍果(紅肉)", "dragon fruit pitaya red"], ["火龍果(白肉)", "dragon fruit pitaya white"], ["番石榴(珍珠)", "guava"], ["蓮霧", "wax apple jambu"],
  ["文旦", "pomelo"], ["桶柑", "mandarin tangerine orange"], ["椪柑", "mandarin ponkan tangerine"], ["海梨柑", "mandarin tangerine"], ["茂谷柑", "mandarin murcott tangerine"],
  ["荔枝(黑葉)", "lychee litchi"], ["新世紀梨", "pear"], ["新興梨", "pear"], ["橫山梨", "pear"], ["牛心柿", "persimmon"], ["甜柿", "persimmon sweet"], ["紅柿(軟柿)", "persimmon soft"], ["棗子", "jujube date"],
  ["虱目魚", "milkfish fish"], ["吳郭魚", "tilapia fish"], ["金目鱸", "barramundi sea bass fish"], ["龍虎斑", "grouper fish"], ["午仔魚", "threadfin fish"],
  ["白蝦", "shrimp prawn white"], ["文蛤", "clam clams"],
];
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim();
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "kg", "in", "taiwan", "taichung", "how", "much", "is", "for", "retail", "market", "fresh", "meat"]);
const QUERY_SYNONYMS: Record<string, string> = { chilies: "chilli", scallions: "scallion", prawns: "prawn", tomatoes: "tomato", potatoes: "potato", lychees: "lychee" };

export interface Def { key: string; english: string; rank: number; row: DailyRow }

export function defsFor(rows: DailyRow[]): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== NATIONAL || r.n < MIN_PUBLISH) continue;
    const i = GLOSS.findIndex(([k]) => k === r.item);
    out.push({ key: r.item, english: i >= 0 ? GLOSS[i][1].split(" ").slice(0, 3).join(" ") : "", rank: i >= 0 ? i : 999, row: r });
  }
  return out;
}

/** Products matching a question in English or Chinese: every query word is a word of the gloss, or a piece of the Chinese name. Preferred (earlier in GLOSS) first. */
export function matchItems(defs: Def[], query: string): Def[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(QUERY_SYNONYMS[w] ?? w));
  if (!words.length) return [];
  const hits: Def[] = [];
  for (const d of defs) {
    const i = GLOSS.findIndex(([k]) => k === d.key);
    const has = new Set((i >= 0 ? GLOSS[i][1].split(" ") : []).map(stem));
    const ok = words.every((w) => has.has(w) || (/[一-鿿]/.test(w) && d.key.includes(w)));
    if (ok) hits.push(d);
  }
  return hits.sort((a, b) => a.rank - b.rank || b.row.n - a.row.n);
}

function methodText() {
  return (
    "Median and 10th–90th percentile of the market-day average prices recorded by Taichung City in its public retail markets over the last 14 days of data, in New Taiwan dollars per kg " +
    "(published per catty 斤 = 600 g, converted). Posted market prices, not receipts; n is the number of market-day prices (5 or more needed); one city, not Taiwan as a whole."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function taichungAnswerFromRows(day: LibraryDay, input: { item?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday food in plain words such as 'eggs', 'pork loin', 'cabbage', 'garlic', 'banana' or 'milkfish' (or its Chinese name).");
  const from = isoOf(dayNumber(day.date) - (WINDOW_DAYS - 1));
  const hits = matchItems(defsFor(day.rows), item);
  if (!hits.length) {
    const names = defsFor(day.rows).sort((a, b) => a.rank - b.rank).map((d) => (d.english ? `${d.english} (${d.key})` : d.key)).slice(0, 40);
    return buildAnswer({
      source: INFO, query: { country: "TW", item }, summary: null, currency: "TWD", unit: "per kg",
      period: { from, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: `No product matching '${item}' has 5 or more market-day prices in our copy. Products held include: ${names.join("; ")}.` },
    });
  }
  const best = hits[0], r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > 10;
  const label = best.english ? `${best.english} (${best.key})` : best.key;
  const others = hits.slice(1, 9).map((d) => (d.english ? `${d.english} (${d.key})` : d.key));
  return buildAnswer({
    source: INFO,
    query: { country: "TW", item: label },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "TWD",
    unit: "per kg",
    period: { from, to: day.date },
    method: methodText(),
    describe: (x) =>
      `Taichung City's public retail markets posted ${label} at a median of ${fmtMoney(x.median, "TWD")} per kg ` +
      `(10th–90th percentile ${fmtMoney(x.low, "TWD")}–${fmtMoney(x.high, "TWD")}) over ${from} to ${day.date}. ` +
      `These are posted market prices from one city, not receipts.` + (stale ? ` The newest data is ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: { market_days: r.n, area: "Taichung City (13 public retail markets)", ...(others.length ? { other_products: others } : {}), ...(stale ? { stale: true, days_since_newest: ageDays } : {}) },
  });
}

export async function taichungPrices(input: { item?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Taichung market price file daily; data appears after the next collection.");
  return taichungAnswerFromRows(day, input);
}

export function taichungHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const best = matchItems(defsFor(day.rows), String(p.item))[0];
    return best ? { area: NATIONAL, item: best.key, label: `${best.english || best.key}, Taichung` } : null;
  } catch {
    return null;
  }
}
