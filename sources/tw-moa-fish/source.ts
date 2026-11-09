// Taiwan fish and seafood wholesale markets: daily trading prices per species and market, from the Ministry of Agriculture (MOA) open data.
// Format checked 2026-11-09 from the cloud workspace: GET https://data.moa.gov.tw/Service/OpenData/FromM/AquaticTransData.aspx?IsTransData=1&UnitId=039
// = 200 JSON, a plain array of at most 9999 rows (about 10 trading days, newest first). Row: {"交易日期":"1151109" (Minguo year+month+day, 115 = 2026),
// "品種代碼":4061, "魚貨名稱":"大正蝦海", "市場名稱":"基隆", "上價":1100.0, "中價":850.0, "下價":450.0, "交易量":3922.0, "平均價":850.0}. Prices are NT$ per kg.
// Some rows have 0 prices or 0 volume (dropped). Names with 凍 are frozen, 其他 is "other": both left out. Server-side date filters were not found.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { aggregateDaily } from "../../lib/library/aggregate";

export const URL_FEED = "https://data.moa.gov.tw/Service/OpenData/FromM/AquaticTransData.aspx?IsTransData=1&UnitId=039";
export const PAGE_URL = "https://data.gov.tw/en/datasets/7299";
export const LICENCE_URL = "https://data.gov.tw/license";

export const INFO: SourceInfo = {
  id: "tw-moa-fish",
  country: "TW (Taiwan)",
  category: "wholesale-fresh-food (fish and seafood)",
  name: "Ministry of Agriculture, Taiwan: fishery product trading market prices",
  publisher: "Ministry of Agriculture (formerly Council of Agriculture), Taiwan, open data service (data.gov.tw dataset 7299)",
  what_is_recorded:
    "The daily average trading price of one fish or seafood species at one wholesale fish market, in New Taiwan dollars (NT$) per kilogram, with the volume traded.",
  price_type: "transaction",
  freshness: "Daily, trading days only; about 10 trading days are available at a time",
  licence: "Government Open Data License v1.0 (Taiwan)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Fishery product trading market, Ministry of Agriculture (Taiwan), Government Open Data License v1.0 (data.gov.tw). Ranges are calculated by ProofPrice from the daily market averages.",
  homepage: PAGE_URL,
  limits:
    "Wholesale prices between traders at 22 fish markets, not shop prices and not what a fisher received. Each record is one market's daily average for one species, so the range shows market and size differences as well as day-to-day changes. " +
    "Frozen products and the 'other' groups are left out. The unit (kg) follows the Ministry's market reports.",
};

export const METHOD =
  "Taiwan wholesale fish: the daily average trading prices (NT$ per kg) that the fish markets report to the Ministry of Agriculture, for the newest three trading days. " +
  "We take every market-day average of the species (frozen products excluded) and give the median, the 10th to 90th percentile and the lowest and highest; a record is one species at one market on one day.";

/** English name to the Taiwanese name of the species in the feed. Exact match on 魚貨名稱 (a trailing 養 = farmed also counts). A token starting with "~" matches anywhere in the name. */
export const PRODUCTS: Record<string, string[]> = {
  tilapia: ["吳郭魚"],
  milkfish: ["虱目魚"],
  "asian seabass": ["金目鱸"],
  threadfin: ["午仔魚"],
  hairtail: ["（日本）白帶魚", "白帶魚"],
  "swordtip squid": ["透抽"],
  cuttlefish: ["花枝"],
  "small squid": ["小卷"],
  clam: ["文蛤"],
  oyster: ["牡蠣"],
  "white shrimp": ["白蝦"],
  "tiger prawn": ["~大正蝦"],
  salmon: ["鮭魚"],
  "grass carp": ["草魚"],
  "bighead carp": ["大頭鰱"],
  grouper: ["石斑魚"],
  "pearl grouper": ["珍珠龍膽/龍虎斑"],
  "white pomfret": ["白鯧"],
  "black pomfret": ["黑鯧"],
  "spanish mackerel": ["土魠"],
  mackerel: ["鯖魚"],
  "sweetfish": ["香魚"],
  "yellow croaker": ["黃花"],
  "milkfish belly": ["虱目魚肚"],
};

const ALIASES: Record<string, string> = {
  fish: "", // handled as unknown
  "tilapias": "tilapia", "tilapia fish": "tilapia", "milk fish": "milkfish", "sea bass": "asian seabass", barramundi: "asian seabass", seabass: "asian seabass",
  "asian sea bass": "asian seabass", squid: "swordtip squid", "sword tip squid": "swordtip squid", "cuttlefish": "cuttlefish", clams: "clam", oysters: "oyster",
  shrimp: "white shrimp", "whiteleg shrimp": "white shrimp", prawn: "tiger prawn", prawns: "tiger prawn", "tiger shrimp": "tiger prawn", "grass carps": "grass carp",
  groupers: "grouper", pomfret: "white pomfret", "silver pomfret": "white pomfret", "spanish mackerels": "spanish mackerel", "king mackerel": "spanish mackerel",
  mackerels: "mackerel", ayu: "sweetfish", "croaker": "yellow croaker", "hairtails": "hairtail", "cutlassfish": "hairtail", "salmons": "salmon", "threadfins": "threadfin",
};

const norm = (s: string) => s.trim();

export interface Product { key: string; tokens: string[] }

/** The species asked for, by English name, alias or Taiwanese name. Null when unknown. */
export function resolveProduct(input: string): Product | null {
  const raw = input.trim();
  const lc = raw.toLowerCase().replace(/\s+/g, " ");
  const key = PRODUCTS[lc] ? lc : ALIASES[lc] && PRODUCTS[ALIASES[lc]] ? ALIASES[lc] : undefined;
  if (key) return { key, tokens: PRODUCTS[key] };
  if (/[㐀-鿿]/.test(raw)) {
    const zh = norm(raw);
    for (const [k, tokens] of Object.entries(PRODUCTS)) if (tokens.some((t) => t === zh || t === "~" + zh)) return { key: k, tokens };
    return zh.length >= 2 ? { key: zh, tokens: [zh] } : null;
  }
  return null;
}

export function productHelp(): string {
  return Object.keys(PRODUCTS).join(", ");
}

export function unknownProduct(asked: string): string {
  return `Taiwan fish: '${asked}' is not one of the species we know. Use one of: ${productHelp()} (or the Taiwanese name).`;
}

// ---------- parsing ----------

export interface Row { date: string; code: number; name: string; market: string; avg: number; qty: number }

/** Minguo date "1151109" to "2026-11-09". Null when it is not one. */
export function minguoToIso(s: unknown): string | null {
  const m = /^(\d{2,3})(\d{2})(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

const isFrozenOrOther = (name: string) => /凍/.test(name) || name.startsWith("其他") || name === "什魚" || name === "肉魚";

/** Usable fresh-product trading rows. Zero prices, zero volumes, frozen and "other" groups are dropped. Throws SourceError on a changed layout. */
export function parseRows(json: unknown): Row[] {
  if (!Array.isArray(json)) {
    throw new SourceError("The Ministry of Agriculture changed the layout of its fishery trading feed (expected a JSON array of rows); this source needs updating.");
  }
  const out: Row[] = [];
  let looksRight = 0;
  for (const r of json as any[]) {
    if (!r || typeof r !== "object") continue;
    if (r["交易日期"] !== undefined && r["魚貨名稱"] !== undefined && r["平均價"] !== undefined) looksRight++;
    const date = minguoToIso(r["交易日期"]);
    const avg = Number(r["平均價"]);
    const qty = Number(r["交易量"]);
    const name = String(r["魚貨名稱"] ?? "").trim();
    if (!date || !name || isFrozenOrOther(name) || !(avg > 0) || !(qty > 0)) continue;
    out.push({ date, code: Number(r["品種代碼"]) || 0, name, market: String(r["市場名稱"] ?? "").trim(), avg, qty });
  }
  if (json.length && !looksRight) {
    throw new SourceError("The Ministry of Agriculture fishery trading feed no longer has the expected fields (交易日期, 魚貨名稱, 平均價); this source needs updating.");
  }
  return out;
}

function matches(row: Row, tokens: string[]): boolean {
  return tokens.some((t) => (t.startsWith("~") ? row.name.includes(t.slice(1)) : row.name === t || row.name === t + "養"));
}

// ---------- answer ----------

export interface Input { product?: string; baseUrl?: string }

const r1 = (v: number) => Math.round(v * 10) / 10;

export function answerFromRows(all: Row[], input: Input): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'tilapia', 'milkfish', 'white shrimp', 'squid' or 'salmon'.");
  const prod = resolveProduct(asked);
  if (!prod) throw new InputError(unknownProduct(asked));
  const rows = all.filter((r) => matches(r, prod.tokens));
  // newest 3 trading days that have at least 5 records between them; widen to everything fetched when that leaves fewer than 5
  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  let used = rows.filter((r) => dates.slice(0, 3).includes(r.date));
  if (used.length < 5) used = rows;
  const usedDates = [...new Set(used.map((r) => r.date))].sort();
  const s = summarise(used.map((r) => r.avg));
  const markets = [...new Set(used.map((r) => r.market))].sort();
  const volume = used.reduce((a, r) => a + r.qty, 0);
  const wmean = volume > 0 ? used.reduce((a, r) => a + r.avg * r.qty, 0) / volume : null;
  return buildAnswer({
    source: INFO,
    query: { country: "TW", product: prod.key === asked.toLowerCase() ? prod.key : asked },
    summary: s,
    currency: "TWD",
    unit: "per kg",
    period: { from: usedDates[0] ?? null, to: usedDates[usedDates.length - 1] ?? null },
    method: METHOD,
    describe: (x) => `Wholesale ${prod.key} in Taiwan: median NT$${x.median} per kg (typical NT$${x.low} to NT$${x.high}).`,
    baseUrl: input.baseUrl,
    extra: {
      note: "Wholesale fish-market prices between traders, per kilogram: not what a shopper pays and not what a fisher received.",
      volume_traded_kg: Math.round(volume),
      volume_weighted_mean_ntd_per_kg: wmean === null ? null : r1(wmean),
      markets,
      trading_days: usedDates,
      record: "average price of one species at one market on one day",
    },
  });
}

export async function fetchFeed(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 30000)): Promise<Row[]> {
  return parseRows(await fetcher(URL_FEED));
}

export async function twFish(input: Input, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  if (!input.product?.trim()) throw new InputError("product is required, for example 'tilapia', 'milkfish', 'white shrimp', 'squid' or 'salmon'.");
  if (!resolveProduct(input.product)) throw new InputError(unknownProduct(input.product)); // no network call for a species we cannot match
  return answerFromRows(await fetchFeed(fetcher), input);
}

// ---------- daily collector ----------

/** One national row per known species for one trading day (median and percentiles over the market averages). Species with under 5 records are left out. */
export function harvestFromRows(rows: Row[], date: string): HarvestResult {
  const day = rows.filter((r) => r.date === date);
  const records: { area: string; item: string; price: number }[] = [];
  for (const [key, tokens] of Object.entries(PRODUCTS)) for (const r of day) if (matches(r, tokens)) records.push({ area: "ALL", item: key, price: r.avg });
  const out = aggregateDaily(records, false).filter((x) => x.n >= 5);
  if (!out.length) throw new SourceError(`Taiwan fish trading feed had no usable records for ${date} (market holiday or changed layout).`);
  return { date, currency: "TWD", unit: "per kg", rows: out, note: `Median, 10th to 90th percentile of the daily market averages (one per species and market) on ${date}; frozen products excluded.` };
}

/** The newest date with a full day of records (the newest date is often only partly published). */
export function newestFullDay(rows: Row[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.date, (counts.get(r.date) ?? 0) + 1);
  const full = [...counts.entries()].filter(([, n]) => n >= 100).map(([d]) => d).sort().reverse();
  return full[0] ?? null;
}

export async function twHarvest(fetcher?: (url: string) => Promise<unknown>): Promise<HarvestResult> {
  const rows = await fetchFeed(fetcher);
  const date = newestFullDay(rows);
  if (!date) throw new SourceError("Taiwan fish trading feed: no trading day with a full set of records found.");
  return harvestFromRows(rows, date);
}

export function twHistoryKey(p: { country: string; product: string }): { area: string; item: string; label: string } | null {
  if (String(p.country).trim().toUpperCase() !== "TW") return null;
  const prod = resolveProduct(String(p.product ?? ""));
  if (!prod || !PRODUCTS[prod.key]) return null;
  return { area: "ALL", item: prod.key, label: `Taiwan wholesale ${prod.key}` };
}
