// Taiwan wholesale produce markets: daily trading averages per variety and market, from the Council of Agriculture (Ministry of Agriculture) open-data API.
// Format checked 2026-10-20 from GitHub's servers (probe): GET https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time=115.10.19&End_time=115.10.19&TcType=N04
// returns {"RS":"OK","Data":[...]}. Dates are Minguo (115 = 2026). TcType N04 = vegetables, N05 = fruit, N06 = flowers (not used). Row fields: TransDate,
// TcType, CropCode, CropName ("base-variety", e.g. "甘藍-初秋"), MarketCode, MarketName, Upper_Price, Middle_Price, Lower_Price, Avg_Price (TWD per kg), Trans_Quantity (kg).
// A closed market is a row with CropName 休市 and all zeros. The feed returns at most about 1000 rows per request (one trading day holds about 1500), checked 2026-10-20:
// a multi-day request without a filter silently drops the older days. The CropName filter (matches anywhere in the name, percent-encoded Chinese) keeps each request small.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { aggregateDaily } from "../../lib/library/aggregate";

export const API = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/";
export const PAGE_URL = "https://data.moa.gov.tw/api.aspx";
export const LICENCE_URL = "https://data.gov.tw/license";
const TYPES = ["N04", "N05"] as const;

export const INFO: SourceInfo = {
  id: "tw-coa-wholesale",
  country: "TW (Taiwan)",
  category: "wholesale vegetable and fruit markets",
  name: "Council of Agriculture, Taiwan: agricultural product trading (wholesale markets)",
  publisher: "Council of Agriculture (Ministry of Agriculture), Taiwan, open data service",
  what_is_recorded:
    "The daily average auction/trading price of one variety of vegetable or fruit at one wholesale market, in New Taiwan dollars (NT$) per kilogram, with the volume traded.",
  price_type: "transaction",
  freshness: "Daily, trading days only (a closed market publishes nothing)",
  licence: "Government Open Data License v1.0 (Taiwan)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Council of Agriculture (Ministry of Agriculture), Taiwan, agricultural product trading open data (data.moa.gov.tw), Government Open Data License v1.0. Ranges are calculated by ProofPrice from the daily market averages.",
  homepage: PAGE_URL,
  limits:
    "Wholesale prices between traders at the main wholesale markets, not shop prices and not farm-gate prices. Each record is a market's daily average for one variety, so the range shows variety and market differences as well as day-to-day changes. " +
    "Flowers, meat and fish are not included. Imported produce is left out unless no domestic record exists.",
};

export const METHOD =
  "Taiwan wholesale produce: the daily average trading prices (NT$ per kg) that wholesale markets report to the Council of Agriculture, for the newest few trading days. " +
  "We take every market-day average of every variety of the product (imports excluded) and give the median, the 10th to 90th percentile and the lowest and highest; a record is one variety at one market on one day.";

// ---------- products and markets ----------

/** English name to Taiwanese base names (the part of CropName before "-"). A token starting with "~" matches anywhere in the full CropName. */
export const PRODUCTS: Record<string, string[]> = {
  cabbage: ["甘藍"],
  "chinese cabbage": ["包心白"],
  "pak choi": ["小白菜", "青江白菜"],
  "water spinach": ["蕹菜"],
  celery: ["芹菜"],
  cauliflower: ["花椰菜"],
  broccoli: ["青花菜", "青花苔"],
  cucumber: ["胡瓜", "花胡瓜"],
  luffa: ["絲瓜"],
  "bitter gourd": ["苦瓜"],
  "wax gourd": ["冬瓜"],
  eggplant: ["茄子"],
  tomato: ["番茄"],
  "cherry tomato": ["小番茄"],
  "bell pepper": ["甜椒"],
  chili: ["辣椒"],
  "green beans": ["菜豆", "敏豆"],
  peas: ["豌豆"],
  corn: ["玉米"],
  radish: ["蘿蔔"],
  carrot: ["胡蘿蔔"],
  onion: ["洋蔥"],
  "spring onion": ["青蔥"],
  "sweet potato": ["甘薯"],
  potato: ["馬鈴薯"],
  taro: ["芋"],
  "bean sprouts": ["芽菜類"],
  "gai lan": ["芥藍菜"],
  banana: ["香蕉"],
  pineapple: ["鳳梨"],
  ponkan: ["椪柑"],
  orange: ["甜橙"],
  lemon: ["~檸檬"],
  grapefruit: ["葡萄柚"],
  pomelo: ["柚子"],
  watermelon: ["西瓜"],
  melon: ["洋香瓜", "甜瓜"],
  papaya: ["木瓜"],
  guava: ["番石榴"],
  "wax apple": ["蓮霧"],
  grapes: ["葡萄"],
  apple: ["蘋果"],
  pear: ["梨"],
  persimmon: ["柿子"],
  "dragon fruit": ["紅龍果"],
  avocado: ["酪梨"],
  kiwi: ["奇異果"],
  "sugar apple": ["釋迦"],
  "passion fruit": ["百香果"],
  coconut: ["椰子"],
};

const ALIASES: Record<string, string> = {
  cabbages: "cabbage", potatoes: "potato", tomatoes: "tomato", cucumbers: "cucumber", onions: "onion", carrots: "carrot", bananas: "banana", pineapples: "pineapple",
  apples: "apple", pears: "pear", oranges: "orange", lemons: "lemon", guavas: "guava", melons: "melon", papayas: "papaya", mandarin: "ponkan",
  mandarins: "ponkan", "sweet potatoes": "sweet potato", grape: "grapes", "green bean": "green beans",
  beans: "green beans", "bok choy": "pak choi", "pak choy": "pak choi", "napa cabbage": "chinese cabbage", "spring onions": "spring onion", scallion: "spring onion",
  eggplants: "eggplant", aubergine: "eggplant", peppers: "bell pepper", "bell peppers": "bell pepper", "capsicum": "bell pepper", chilli: "chili", maize: "corn",
  "dragonfruit": "dragon fruit", "pitaya": "dragon fruit", persimmons: "persimmon", "custard apple": "sugar apple", sugarapple: "sugar apple", pomelos: "pomelo",
  "water melon": "watermelon", "wax apples": "wax apple", "lotus fog": "wax apple", kale: "gai lan", "chinese kale": "gai lan", avocados: "avocado", kiwis: "kiwi", "kiwi fruit": "kiwi",
};

/** English market name to the Chinese prefix of MarketName. Unlisted markets still match by their Chinese name. */
export const MARKETS: Record<string, string> = {
  taipei: "台北", banqiao: "板橋", sanchong: "三重", yilan: "宜蘭", taoyuan: "桃農", taichung: "台中", fengyuan: "豐原", xihu: "溪湖", xiluo: "西螺",
  chiayi: "嘉義", dongshi: "東勢", kaohsiung: "高雄", fengshan: "鳳山", pingtung: "屏東", taitung: "台東", hualien: "花蓮", tainan: "台南", changhua: "彰化",
};

const norm = (s: string) => s.replace(/臺/g, "台").trim();
const baseOf = (cropName: string) => cropName.split("-")[0];

export interface Product { key: string; tokens: string[] }

/** The product asked for, by English name, alias or Taiwanese name. Null when unknown. */
export function resolveProduct(input: string): Product | null {
  const raw = input.trim();
  const lc = raw.toLowerCase().replace(/\s+/g, " ");
  const key = PRODUCTS[lc] ? lc : ALIASES[lc];
  if (key && PRODUCTS[key]) return { key, tokens: PRODUCTS[key] };
  const zh = norm(raw);
  if (/[㐀-鿿]/.test(zh)) {
    for (const [k, tokens] of Object.entries(PRODUCTS)) if (tokens.some((t) => t === zh || t === "~" + zh)) return { key: k, tokens };
    return { key: zh, tokens: [zh.length >= 2 ? "~" + zh : zh] };
  }
  return null;
}

export function unknownProduct(asked: string): string {
  return `Taiwan: '${asked}' is not one of the products we know. Use one of: ${productHelp()} (or the Taiwanese name).`;
}

export function productHelp(): string {
  return Object.keys(PRODUCTS).join(", ");
}

function matches(row: Row, tokens: string[]): boolean {
  const base = baseOf(row.crop);
  return tokens.some((t) => (t.startsWith("~") ? row.crop.includes(t.slice(1)) : base === t));
}

// ---------- parsing ----------

export interface Row { date: string; type: string; crop: string; marketCode: string; market: string; avg: number; qty: number }

/** Minguo date "115.10.19" to "2026-10-19". Null when it is not one. */
export function minguoToIso(s: unknown): string | null {
  const m = /^(\d{2,3})\.(\d{1,2})\.(\d{1,2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${Number(m[1]) + 1911}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isoToMinguo(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y - 1911}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}

/** Taiwan's calendar date (UTC+8) `back` days before now, as ISO. */
export function taiwanDate(back = 0, now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 3600_000 - back * 86400_000);
  return t.toISOString().slice(0, 10);
}

/** Usable trading rows of vegetables and fruit: closed-market rows, zero prices and zero volumes are dropped. Throws SourceError on a changed layout. */
export function parseRows(json: unknown): Row[] {
  const j = json as any;
  if (!j || typeof j !== "object" || j.RS !== "OK" || !Array.isArray(j.Data)) {
    throw new SourceError("The Council of Agriculture changed the layout of its trading feed (expected {RS:'OK', Data:[...]}); this source needs updating.");
  }
  const out: Row[] = [];
  for (const r of j.Data as any[]) {
    if (!r || typeof r !== "object") continue;
    const date = minguoToIso(r.TransDate);
    const avg = Number(r.Avg_Price);
    const qty = Number(r.Trans_Quantity);
    const crop = String(r.CropName ?? "").trim();
    const type = String(r.TcType ?? "");
    if (!date || !crop || crop === "休市" || crop === "其他" || !(avg > 0) || !(qty > 0) || !TYPES.includes(type as any)) continue;
    out.push({ date, type, crop, marketCode: String(r.MarketCode ?? ""), market: String(r.MarketName ?? "").trim(), avg, qty });
  }
  if (j.Data.length && !out.length && !j.Data.some((r: any) => r && typeof r === "object" && r.TransDate && r.CropName && r.Avg_Price !== undefined)) {
    throw new SourceError("The Council of Agriculture trading feed had no usable vegetable or fruit rows; this source needs updating.");
  }
  return out;
}

// ---------- answer ----------

export interface Input { product?: string; market?: string; baseUrl?: string }

const wmean = (rows: Row[]) => {
  const q = rows.reduce((a, r) => a + r.qty, 0);
  return q > 0 ? rows.reduce((a, r) => a + r.avg * r.qty, 0) / q : null;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

export function answerFromRows(all: Row[], input: Input): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'cabbage', 'tomato', 'banana' or 'pineapple'.");
  const prod = resolveProduct(asked);
  if (!prod) throw new InputError(unknownProduct(asked));
  const marketAsked = input.market ? norm(input.market) : undefined;
  let prefix: string | undefined;
  if (marketAsked) prefix = MARKETS[marketAsked.toLowerCase()] ?? (/[㐀-鿿]/.test(marketAsked) ? marketAsked : undefined);
  if (marketAsked && !prefix) {
    throw new InputError(`Taiwan: market '${marketAsked}' is not one we know. Use one of: ${Object.keys(MARKETS).join(", ")} (or the Taiwanese market name), or leave market out.`);
  }
  const query = { country: "TW", product: prod.key === asked.toLowerCase() ? prod.key : asked, ...(marketAsked ? { market: marketAsked } : {}) };
  let rows = all.filter((r) => matches(r, prod.tokens) && (!prefix || norm(r.market).startsWith(prefix)));
  const wantsImport = /import|進口/i.test(asked);
  const domestic = rows.filter((r) => !r.crop.includes("進口"));
  const usingImports = wantsImport || domestic.length < 5;
  if (!usingImports) rows = domestic;
  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  // newest 3 trading days; widen to everything we fetched when that leaves fewer than 5 records
  let used = rows.filter((r) => dates.slice(0, 3).includes(r.date));
  if (used.length < 5) used = rows;
  const usedDates = [...new Set(used.map((r) => r.date))].sort();
  const s = summarise(used.map((r) => r.avg));
  const markets = [...new Set(used.map((r) => r.market))].sort();
  const volume = used.reduce((a, r) => a + r.qty, 0);
  const w = wmean(used);
  const note =
    (usingImports && !wantsImport && rows.length ? "Fewer than 5 domestic records, so imported produce is included. " : "") +
    "Wholesale market prices between traders, per kilogram: not what a shopper pays.";
  return buildAnswer({
    source: INFO,
    query,
    summary: s,
    currency: "TWD",
    unit: "per kg",
    period: { from: usedDates[0] ?? null, to: usedDates[usedDates.length - 1] ?? null },
    method: METHOD,
    describe: (x) => `Wholesale ${prod.key} in Taiwan: median NT$${x.median} per kg (typical NT$${x.low} to NT$${x.high}).`,
    baseUrl: input.baseUrl,
    extra: {
      note,
      volume_traded_kg: Math.round(volume),
      volume_weighted_mean_ntd_per_kg: w === null ? null : r1(w),
      markets,
      trading_days: usedDates,
      imports_included: usingImports && rows.some((r) => r.crop.includes("進口")),
      fetched_rows_by_day: Object.fromEntries([...new Set(all.map((r) => r.date))].sort().map((d) => [d, all.filter((r) => r.date === d).length])),
      record: "average price of one variety at one market on one day",
    },
  });
}

/** The feed returns at most about 1000 rows per request and a trading day has about 1500, so we ask per product name (CropName matches anywhere in the name). */
async function fetchTokens(tokens: string[], from: string, to: string, fetcher: (url: string) => Promise<unknown>): Promise<Row[]> {
  const parts = await Promise.all(
    tokens.map((t) => fetcher(`${API}?Start_time=${isoToMinguo(from)}&End_time=${isoToMinguo(to)}&CropName=${encodeURIComponent(t.replace(/^~/, ""))}`)),
  );
  return parts.flatMap((p) => parseRows(p));
}

export async function twWholesale(
  input: Input,
  fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 25000),
  now: Date = new Date(),
): Promise<PriceAnswer> {
  if (!input.product) throw new InputError("product is required, for example 'cabbage', 'tomato', 'banana' or 'pineapple'.");
  if (!resolveProduct(input.product)) throw new InputError(unknownProduct(input.product)); // no network call for a product we cannot match
  const prod = resolveProduct(input.product)!;
  const rows = await fetchTokens(prod.tokens, taiwanDate(7, now), taiwanDate(0, now), fetcher);
  return answerFromRows(rows, input);
}

// ---------- daily collector ----------

/** One national row per known product for one trading day: median/percentiles over the market-day averages (imports excluded). Products with under 5 records are left out. */
export function harvestFromRows(rows: Row[], date: string): HarvestResult {
  const day = rows.filter((r) => r.date === date && !r.crop.includes("進口"));
  const records: { area: string; item: string; price: number }[] = [];
  for (const [key, tokens] of Object.entries(PRODUCTS)) {
    for (const r of day) if (matches(r, tokens)) records.push({ area: "ALL", item: key, price: r.avg });
  }
  const out = aggregateDaily(records, false).filter((x) => x.n >= 5);
  if (!out.length) throw new SourceError(`Taiwan trading feed had no usable records for ${date} (market holiday or changed layout).`);
  return {
    date,
    currency: "TWD",
    unit: "per kg",
    rows: out,
    note: `Median, 10th to 90th percentile of the daily market averages (one per variety and market) on ${date}; imports excluded.`,
  };
}

async function harvestDay(date: string, fetcher: (url: string) => Promise<unknown>): Promise<Row[]> {
  const tokens = [...new Set(Object.values(PRODUCTS).flat())];
  const rows: Row[] = [];
  for (let i = 0; i < tokens.length; i += 6) rows.push(...(await fetchTokens(tokens.slice(i, i + 6), date, date, fetcher)));
  return rows;
}

export async function twHarvest(
  fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 25000),
  now: Date = new Date(),
): Promise<HarvestResult> {
  // newest day that has records: yesterday first, then back to three days earlier (market holidays)
  for (let back = 1; back <= 4; back++) {
    const date = taiwanDate(back, now);
    const rows = await harvestDay(date, fetcher);
    try {
      return harvestFromRows(rows, date);
    } catch (e) {
      if (back === 4) throw e;
    }
  }
  throw new SourceError("Taiwan trading feed: no trading day found in the last four days.");
}

export function twHistoryKey(p: { country: string; product: string }): { area: string; item: string; label: string } | null {
  if (String(p.country).trim().toUpperCase() !== "TW") return null;
  const prod = resolveProduct(String(p.product ?? ""));
  if (!prod || !PRODUCTS[prod.key]) return null;
  return { area: "ALL", item: prod.key, label: `Taiwan wholesale ${prod.key}` };
}
