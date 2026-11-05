// Taipei Metro (Taipei Rapid Transit Corporation) posted fares per station pair, TWD.
// Format checked live on 2026-11-05 from the cloud workspace: plain GET, no key,
// https://data.taipei/api/dataset/4acb4911-0360-4063-808d-fcee629508b3/resource/893c2f2a-dcfd-407b-b871-394a14105532/download
// (453,602 bytes, 17,424 data rows, 119 stations, Content-Type text/csv;charset=BIG-5, so decode as Big5, NOT UTF-8).
// Header: 起站,訖站,全票票價[金額],敬老卡愛心卡愛心陪伴卡及臺北市與新北市兒童優惠票價[金額],距離  (from, to, full fare, concession fare, km).
// Rows repeat (14,161 distinct pairs, duplicates are identical). The file name carries the ROC date, e.g. (1150929) = 2026-09-29.
// Posted tariff, not paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_FARES =
  "https://data.taipei/api/dataset/4acb4911-0360-4063-808d-fcee629508b3/resource/893c2f2a-dcfd-407b-b871-394a14105532/download";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "tw-taipei-metro-fares",
  country: "TW",
  category: "transport fares (Taipei Metro)",
  name: "Taipei Metro fares between stations (Taipei Rapid Transit Corporation open data)",
  publisher: "Taipei Rapid Transit Corporation (Taipei Metro), published on data.taipei and data.gov.tw",
  what_is_recorded:
    "The posted fare for one Taipei Metro journey between two stations (14,000+ station pairs, 119 stations): the full fare, and the concession fare for senior, Love Card and companion card holders and for children in Taipei and New Taipei. A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Irregular: updated by the operator when fares change; the file name carries its date",
  licence: "Taiwan Open Government Data License v1.0 (perpetual, worldwide, non-exclusive, irrevocable, royalty-free licence to use the open data for any purpose, with attribution to the data provider)",
  licence_url: "https://data.gov.tw/en/license",
  attribution:
    "Contains information from the Taipei Metro fare table (Taipei Rapid Transit Corporation) accessed from data.taipei / data.gov.tw (https://data.gov.tw/en/datasets/128418) under the Taiwan Open Government Data License v1.0 (https://data.gov.tw/en/license). " +
    "ProofPrice looks up the station pair; this is not an official service of Taipei Metro or the Taipei City Government.",
  homepage: "https://data.gov.tw/en/datasets/128418",
  limits:
    "Posted Taipei Metro fares per station pair, not amounts paid, not a ticket and not a quote. Other lines and operators (Danhai light rail, Circular line, High Speed Rail, TRA), passes and discounts such as EasyCard rebates are not included. No sample size.",
};

export type FareGroup = "adult" | "senior" | "disability";

export interface Pair {
  from: string;
  to: string;
  full: number;
  concession: number;
  km: number;
}

/** Pure: decode the Big5 bytes of the fare file. */
export function decodeBig5(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("big5").decode(bytes);
}

/** Pure: the CSV text into distinct station pairs. Bad rows are skipped; far too few pairs is an error. */
export function parseFares(text: string): Pair[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = (lines[0] ?? "").split(",");
  if (head.length !== 5 || !head[2].startsWith("全票票價") || !head[3].includes("優惠票價") || head[4].trim() !== "距離") {
    throw new SourceError("The Taipei Metro fare file has different columns than expected; this source needs updating.");
  }
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    if (f.length !== 5) continue;
    const p: Pair = { from: f[0].trim(), to: f[1].trim(), full: Number(f[2]), concession: Number(f[3]), km: Number(f[4]) };
    if (!p.from || !p.to || !Number.isFinite(p.full) || !Number.isFinite(p.concession) || p.full <= 0) continue;
    const key = p.from + "|" + p.to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  if (out.length < 1000) throw new SourceError("The Taipei Metro fare file has far fewer station pairs than expected; this source needs updating.");
  return out;
}

/** English names people use, mapped to the Chinese names in the file (each checked against the station list of 5 Nov 2026). */
export const ALIASES: Record<string, string> = {
  "taipei main station": "台北車站", "taipei station": "台北車站", "taipei main": "台北車站",
  "taipei 101": "台北101/世貿", "taipei 101 world trade center": "台北101/世貿", "world trade center": "台北101/世貿",
  "songshan airport": "松山機場", "taipei songshan airport": "松山機場",
  "nangang exhibition center": "南港展覽館", "nangang": "南港", "tamsui": "淡水", "danshui": "淡水",
  "ximen": "西門", "zhongshan": "中山", "shilin": "士林", "beitou": "北投", "xinbeitou": "新北投", "banqiao": "板橋",
  "taipei zoo": "動物園", "taipei arena": "台北小巨蛋", "taipei city hall": "市政府", "sun yat sen memorial hall": "國父紀念館",
  "chiang kai shek memorial hall": "中正紀念堂", "ntu hospital": "台大醫院", "longshan temple": "龍山寺", "gongguan": "公館",
  "guting": "古亭", "dongmen": "東門", "daan": "大安", "da an": "大安", "zhongxiao fuxing": "忠孝復興", "zhongxiao dunhua": "忠孝敦化",
  "xinyi anhe": "信義安和", "yuanshan": "圓山", "jiantan": "劍潭", "shuanglian": "雙連", "xindian": "新店", "neihu": "內湖",
  "nanshijiao": "南勢角", "zhishan": "芝山", "tucheng": "土城", "sanchong": "三重", "luzhou": "蘆洲", "xinzhuang": "新莊",
  "xiangshan": "象山", "dazhi": "大直", "wende": "文德", "donghu": "東湖", "kunyang": "昆陽", "muzha": "木柵",
};
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();

/** Pure: find one station by Chinese name or a known English name. */
export function findStation(pairs: Pair[], text: string, what: string): string {
  const raw = text.trim();
  if (!raw) throw new InputError(`Give a ${what}, for example "Taipei Main Station" or "台北車站".`);
  const stations = new Set<string>();
  for (const p of pairs) { stations.add(p.from); stations.add(p.to); }
  const t = norm(raw);
  const alias = ALIASES[t];
  if (alias && stations.has(alias)) return alias;
  for (const s of stations) if (norm(s) === t) return s;
  const near = [...stations].filter((s) => norm(s).includes(t) || (t.length > 1 && t.includes(norm(s)))).sort().slice(0, 8);
  const hint = near.length
    ? ` Did you mean: ${near.join(", ")}?`
    : ` ${stations.size} stations are available, by Chinese name such as 台北車站 or by English name such as Taipei Main Station, Taipei 101, Songshan Airport, Tamsui, Ximen.`;
  throw new InputError(`Not yet known: ${what} "${text}" is not a Taipei Metro station name.${hint}`);
}

export interface FareInput {
  from_station?: string;
  to_station?: string;
  fare_type?: string;
  baseUrl?: string;
  published?: string | null;
}

const GROUP_LABEL: Record<FareGroup, string> = {
  adult: "full (adult)",
  senior: "concession (senior card, Love Card, companion card; children in Taipei and New Taipei)",
  disability: "concession (senior card, Love Card, companion card; children in Taipei and New Taipei)",
};
const METHOD =
  "Taipei Metro: the Taipei Rapid Transit Corporation's posted fare for one journey between the two stations, from its open-data fare table, for the full fare or the concession fare, in New Taiwan dollars. " +
  "A published fare table, the same for everyone in the group, not a count of fares paid; other lines and operators are not included.";

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromFares(pairs: Pair[], input: FareInput): PriceAnswer {
  if (!input.from_station || !input.to_station) {
    throw new InputError("Give origin_station and destination_station for Taiwan (Taipei Metro), for example origin_station=Taipei Main Station&destination_station=Taipei 101.");
  }
  const group = (input.fare_type ?? "adult").toString().toLowerCase() as FareGroup;
  if (!(group in GROUP_LABEL)) throw new InputError("fare_type for TW must be adult (full fare), or senior / disability (both are the one concession fare); student and workfare are not included.");
  const a = findStation(pairs, input.from_station, "origin_station");
  const b = findStation(pairs, input.to_station, "destination_station");
  if (a === b) throw new InputError("origin_station and destination_station are the same station; give two different stations.");
  const hit = pairs.find((p) => p.from === a && p.to === b);
  const fare = hit ? (group === "adult" ? hit.full : hit.concession) : NaN;
  const published = input.published ?? null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "TW", from_station: a, to_station: b, fare_type: group },
    value: Number.isFinite(fare) ? fare : null,
    measure: "average",
    currency: "TWD",
    unit: "per journey (Taipei Metro posted fare)",
    period: { from: published, to: null },
    reference_period: published ? `fare table dated ${published}` : "fares in the current Taipei Metro open-data file",
    method: METHOD,
    describe: (v) => `The posted Taipei Metro ${GROUP_LABEL[group].split(" (")[0]} fare from ${a} to ${b} is TWD ${v} per journey (${hit!.km} km).`,
    note: "Posted fare table, not an amount paid. Other lines and operators are not included.",
    baseUrl: input.baseUrl,
    published,
    extra: { from_station: a, to_station: b, fare_group: group, distance_km: hit?.km ?? null, mode: "Metro" },
  });
}

/** Pure: the fare-table date from the download file name, e.g. "...(1150929).csv" (ROC year 115 = 2026) -> "2026-09-29". */
export function dateFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  let name = cd;
  try { name = decodeURIComponent(cd); } catch { /* keep raw */ }
  const m = name.match(/\((\d{3})(\d{2})(\d{2})\)/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${m[2]}-${m[3]}`;
}

let cache: { at: number; pairs: Pair[]; published: string | null } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

async function download(): Promise<{ bytes: Uint8Array; published: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(URL_FARES, { headers: { "user-agent": UA, accept: "text/csv,*/*" }, signal: controller.signal });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, URL_FARES, res.status);
    return { bytes: new Uint8Array(await res.arrayBuffer()), published: dateFromContentDisposition(res.headers.get("content-disposition")) };
  } catch (e: any) {
    if (e instanceof SourceError) throw e;
    if (e?.name === "AbortError") throw new SourceError("Source timed out", URL_FARES);
    throw new SourceError("Could not reach the official source", String(e?.cause?.code ?? e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

export async function twFares(input: FareInput, load?: () => Promise<{ bytes: Uint8Array; published: string | null }>): Promise<PriceAnswer> {
  if (!load && cache && Date.now() - cache.at < CACHE_MS) return answerFromFares(cache.pairs, { ...input, published: cache.published });
  const { bytes, published } = await (load ?? download)();
  const pairs = parseFares(decodeBig5(bytes));
  if (!load) cache = { at: Date.now(), pairs, published };
  return answerFromFares(pairs, { ...input, published });
}
