// Hong Kong home sales from the Land Registry: monthly counts of registered residential sale and purchase agreements by
// consideration (price) band, published on DATA.GOV.HK as consideration_<YYYY>.json (small JSON, 2005 onwards). The file holds
// COUNTS per band, not prices: we estimate the median and the 10th-90th percentile range by interpolating inside the bands
// (deals spread evenly within a band), say so in every answer and never give "high" confidence. The file is a few KB, so
// requests read it live; no daily collector is needed.
// Format shape from the publisher's file as probed 2026-10-30 (all values are strings with thousands commas, blank for months
// not yet published, a "Total" row to drop); see fixtures/consideration_2026.json and source.test.ts.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://data.gov.hk/en-data/dataset/hk-lr-data5-landreg";
export const fileUrl = (year: number): string => `https://www.landreg.gov.hk/datagovhk/consideration_${year}.json`;

export const INFO: SourceInfo = {
  id: "hk-landreg-sales",
  country: "HK (Hong Kong)",
  category: "home sales (estimated from price bands)",
  name: "Hong Kong Land Registry: residential sale and purchase agreements by consideration band",
  publisher: "The Land Registry, HKSAR Government, via DATA.GOV.HK",
  what_is_recorded:
    "The number of residential sale and purchase agreements registered each month, grouped into price (consideration) bands of HKD 1 million (the last band is HKD 20 million or above). " +
    "It covers all of Hong Kong and all kinds of homes, new and second-hand. The file has counts per band, not individual prices.",
  price_type: "transaction",
  freshness: "The Land Registry refreshes the file monthly; each answer names the months it covers (the newest month published is usually the previous one).",
  licence:
    "DATA.GOV.HK Terms and Conditions (Digital Policy Office, HKSAR Government): the data may be browsed, downloaded, distributed and reproduced for commercial and non-commercial purposes free of charge, on condition that the source is identified and the Government, the Relevant Organisations and DATA.GOV.HK are acknowledged. Terms may be amended without notice; data is provided as is.",
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution: "Source: The Land Registry, HKSAR Government, via DATA.GOV.HK. Estimated by ProofPrice from price-band counts; not endorsed by the Government of the Hong Kong SAR.",
  homepage: PAGE_URL,
  limits:
    "The Land Registry publishes COUNTS of deals per price band, not prices. The median and the 10th-90th percentile range are ESTIMATES made by ProofPrice by spreading the deals evenly inside each HKD 1 million band, so they are rounded to the band width and confidence is always low. " +
    "All of Hong Kong and all kinds of homes together: no district, estate, size or type. Agreements are counted when registered. A percentile that falls in the open 'HKD 20 million or above' band is shown as HKD 20 million (a floor). Aggregates only.",
  method_version: "1",
};

export interface Band {
  label: string;
  lo: number; // HKD
  hi: number | null; // HKD, null = open-ended top band
}

export interface MonthCounts {
  month: string; // YYYY-MM
  counts: number[]; // one per band, same order as bands
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MILLION = 1_000_000;

/** "Less than 1" | "3 to less than 4" | "20 or above" -> a band in HKD, or null for the Total row and anything unknown. */
export function parseBand(label: string): Band | null {
  const t = label.trim();
  let m = /^less than (\d+)$/i.exec(t);
  if (m) return { label: t, lo: 0, hi: Number(m[1]) * MILLION };
  m = /^(\d+) to less than (\d+)$/i.exec(t);
  if (m) return { label: t, lo: Number(m[1]) * MILLION, hi: Number(m[2]) * MILLION };
  m = /^(\d+) or above$/i.exec(t);
  if (m) return { label: t, lo: Number(m[1]) * MILLION, hi: null };
  return null;
}

/** "1,075" -> 1075; "" or anything else -> null (month not published yet). */
export function parseCount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.replace(/,/g, "").trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const RANGE_KEY = "Range of Consideration ($ million)";

/** One year's file -> the bands and the months that are fully published (every band has a number). The Total row is dropped. */
export function parseYear(json: unknown, year: number): { bands: Band[]; months: MonthCounts[] } {
  if (!Array.isArray(json)) throw new SourceError("The Land Registry file has an unexpected shape", "not an array");
  const bands: Band[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const band = parseBand(String(rec[RANGE_KEY] ?? ""));
    if (!band) continue;
    bands.push(band);
    rows.push(rec);
  }
  if (bands.length < 5) throw new SourceError("The Land Registry file has an unexpected shape", `only ${bands.length} price bands found`);
  const months: MonthCounts[] = [];
  MONTHS.forEach((mon, i) => {
    const counts = rows.map((r) => parseCount(r[mon]));
    if (counts.every((c) => c !== null)) months.push({ month: `${year}-${String(i + 1).padStart(2, "0")}`, counts: counts as number[] });
  });
  return { bands, months };
}

/** Value at cumulative share p (0..1) when deals are spread evenly inside each band. In the open top band the floor is returned. */
export function bandPercentile(bands: Band[], totals: number[], p: number): { value: number; floor: boolean } {
  const n = totals.reduce((a, b) => a + b, 0);
  const target = p * n;
  let cum = 0;
  for (let i = 0; i < bands.length; i++) {
    const c = totals[i];
    if (c > 0 && cum + c >= target) {
      const b = bands[i];
      if (b.hi === null) return { value: b.lo, floor: true };
      return { value: b.lo + ((b.hi - b.lo) * (target - cum)) / c, floor: false };
    }
    cum += c;
  }
  const last = bands[bands.length - 1];
  return { value: last.lo, floor: last.hi === null };
}

export interface BandEstimate {
  deals: number;
  median: number;
  low: number;
  high: number;
  highIsFloor: boolean;
  from: string; // YYYY-MM
  to: string;
}

/** Sum the newest `months` published months and estimate the median and the 10th-90th percentile from the bands. */
export function estimate(bands: Band[], all: MonthCounts[], months: number): BandEstimate | null {
  const sorted = [...all].sort((a, b) => a.month.localeCompare(b.month));
  const win = sorted.slice(-months);
  if (win.length === 0) return null;
  const totals = bands.map((_, i) => win.reduce((s, m) => s + (m.counts[i] ?? 0), 0));
  const deals = totals.reduce((a, b) => a + b, 0);
  if (deals === 0) return null;
  const med = bandPercentile(bands, totals, 0.5);
  const lo = bandPercentile(bands, totals, 0.1);
  const hi = bandPercentile(bands, totals, 0.9);
  return { deals, median: med.value, low: lo.value, high: hi.value, highIsFloor: hi.floor, from: win[0].month, to: win[win.length - 1].month };
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function answerFrom(bands: Band[], all: MonthCounts[], months: number, baseUrl?: string): PriceAnswer {
  const est = estimate(bands, all, months);
  const summary = est
    ? { count: est.deals, median: est.median, low: est.low, high: est.high, min: est.low, max: est.high }
    : null;
  const answer = buildAnswer({
    source: INFO,
    query: { country: "HK", months },
    summary,
    currency: "HKD",
    unit: "per home (agreement price)",
    period: est ? { from: `${est.from}-01`, to: monthEnd(est.to) } : { from: null, to: null },
    method:
      "Hong Kong: the Land Registry publishes, for each month, how many residential sale and purchase agreements were registered in each HKD 1 million price band (HKD 20 million and above as one band). " +
      `We add up the newest ${months} published month(s) and estimate the median and the 10th-90th percentile range by spreading the deals evenly inside each band. ` +
      "These are estimates from price bands, not individual prices: figures are only as fine as the bands (HKD 1 million) and confidence is low. All of Hong Kong and all kinds of homes together.",
    describe: (s) =>
      `Median agreement price about ${fmtMoney(s.median, "HKD")} (estimated from price bands; typical range ${fmtMoney(s.low, "HKD")} to ${est?.highIsFloor ? "at least " : ""}${fmtMoney(s.high, "HKD")}) across all of Hong Kong.`,
    baseUrl,
    extra: { estimated_from_price_bands: true, band_width_hkd: MILLION, months_used: months, top_band_is_floor: est?.highIsFloor ?? false },
  });
  if (answer.price) {
    // min and max of the band edges would look like a real cheapest and dearest sale: say nothing instead.
    answer.price = { ...answer.price, min: null as unknown as number, max: null as unknown as number };
  }
  return { ...answer, confidence: answer.status === "ok" ? "low" : answer.confidence };
}

async function fetchYear(year: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(fileUrl(year), { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, fileUrl(year), res.status);
    return JSON.parse(stripBom(await res.text()));
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", fileUrl(year));
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkLandRegSales(opts: { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  if (opts.postcode) throw new InputError("Postcode is not supported for Hong Kong: the Land Registry bands cover all of Hong Kong. Leave it out; give a public housing estate as town for the Housing Authority's discounted sales instead.");
  if (opts.property_type && opts.property_type !== "any") throw new InputError("Hong Kong has one figure for all homes together: leave property_type out or use 'any'.");
  const months = opts.months && Number.isFinite(opts.months) ? Math.min(36, Math.max(1, Math.round(opts.months))) : 12;
  const thisYear = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let y = thisYear; y >= thisYear - Math.ceil(months / 12); y--) years.push(y);
  const files = await Promise.all(years.map((y) => fetchYear(y)));
  let bands: Band[] | null = null;
  const all: MonthCounts[] = [];
  files.forEach((json, i) => {
    if (json === null) return;
    const parsed = parseYear(json, years[i]);
    if (!bands) bands = parsed.bands;
    all.push(...parsed.months);
  });
  if (!bands) throw new SourceError("The Land Registry file could not be found", years.join(", "), 404);
  return answerFrom(bands, all, months, opts.baseUrl);
}

export const MIN_DEALS = MIN_PUBLISH;
