// United States: the price of NEW houses sold, nationally, from the U.S. Census Bureau's New Residential Sales survey
// (a joint Census Bureau / HUD survey; the figures are the Bureau's own headline "median and average sales price of new houses sold").
// Raw file: https://www.census.gov/construction/nrs/xls/price_cust.xlsx (about 37 KB, key-free, no sign-up). Two sheets, checked live on 2026-10-24
// through the Probe workflow (see the fixture rows in source.test.ts):
//   "Annual"  : Year | Median sales price | Average sales price           (1963 ... last full year), dollars
//   "Monthly" : Month (Excel date serial, first day of the month) | Median | Average     (from 1963-01), dollars; early averages are "(NA)"
// One national figure per month, no distribution and no record count, so the answer is an official statistic (measure "median",
// range fields null, sample_size null). The file is small, so a request downloads it (cached 6 hours in memory); the daily collector stores
// the newest month once a day so a Census outage is answered from that copy (stale-if-error).

import { excelDate, readXlsx } from "../../categories/rent/xlsx";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, retryOnce } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { NO_COUNT } from "../../lib/stats";

export const FILE_URL = "https://www.census.gov/construction/nrs/xls/price_cust.xlsx";
export const PAGE_URL = "https://www.census.gov/construction/nrs/index.html";
export const HARVEST_ITEM = "new:month";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "us-census-new-home-sales",
  country: "US (United States, national)",
  category: "home sales (new houses sold, official median price)",
  name: "Sales Price of New Privately-Owned Houses Sold, United States (Census Bureau New Residential Sales)",
  publisher: "U.S. Census Bureau (New Residential Sales survey, with the U.S. Department of Housing and Urban Development)",
  what_is_recorded:
    "The median and the average sales price of new privately-owned houses sold in the United States, monthly from 1963 and annually, from the Bureau's survey of new houses " +
    "(single-family houses; sales are counted when a sales contract is signed or a deposit taken). One national figure per month; never an individual sale or an address.",
  price_type: "official_statistic",
  freshness: "Monthly: the Census Bureau publishes each month about three and a half weeks after it ends (the file was last modified on 24 September 2026); every answer states its month, and recent months are later revised by the Bureau",
  licence:
    "Creative Commons CC0 1.0 (public domain dedication): the Census Bureau's own dataset metadata for the New Residential Sales indicator (https://api.census.gov/data/timeseries/eits/ressales) states license " +
    "\"http://creativecommons.org/publicdomain/zero/1.0/\", accessLevel \"public\". The Bureau's citation policy asks users to cite the Census Bureau as the source of the original data only.",
  licence_url: "https://www.census.gov/about/policies/citation.html",
  attribution:
    "Source: U.S. Census Bureau, New Residential Sales (Sales Price of New Privately-Owned Houses Sold), reference month stated in each answer. Figures are passed on as published; " +
    "the percentage changes are calculated by ProofPrice and are not the Census Bureau's. This is not an endorsement by the Census Bureau.",
  homepage: PAGE_URL,
  limits:
    "New houses only (newly built single-family houses sold), nationally: not existing homes, condominiums or apartments, and no state, city or ZIP figure (the file is national). " +
    "A median and an average the Bureau rounds to the nearest hundred dollars; the Bureau publishes no count of sales behind them in this file and no range. " +
    "The newest months are preliminary and are revised by the Bureau; this answer reads the file as it stands today.",
};

// ---------- reading the file ----------

export interface NrsPoint {
  /** "YYYY-MM" for a month, "YYYY" for a year. */
  period: string;
  median: number | null;
  average: number | null;
}
export interface NrsData {
  monthly: NrsPoint[];
  annual: NrsPoint[];
}

const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) && c > 0 ? c : null);

/** Rows of one sheet after its "Median sales price" header: first cell is the period, then the median and the average; stops at the footnotes. */
function readSheet(rows: (string | number | boolean | null)[][], monthly: boolean): NrsPoint[] {
  const head = rows.findIndex((r) => r.some((c) => typeof c === "string" && /median sales price/i.test(c)));
  if (head < 0) throw new SourceError("The Census Bureau changed price_cust.xlsx (no 'Median sales price' header); this source needs updating.");
  const out: NrsPoint[] = [];
  for (const r of rows.slice(head + 1)) {
    const first = r[0];
    if (typeof first === "string" && /^footnotes/i.test(first.trim())) break;
    if (typeof first !== "number") continue;
    let period: string | null;
    if (monthly) {
      const d = excelDate(first);
      period = d ? d.slice(0, 7) : null;
    } else {
      period = Number.isInteger(first) && first >= 1900 && first <= 2200 ? String(first) : null;
    }
    if (!period) continue;
    out.push({ period, median: num(r[1]), average: num(r[2]) });
  }
  return out;
}

/** Parse the workbook. Throws a SourceError in plain words when the layout is not the one we checked. */
export function parseNrs(buf: Buffer): NrsData {
  const sheets = readXlsx(buf);
  const monthly = sheets.find((s) => /^monthly$/i.test(s.name));
  const annual = sheets.find((s) => /^annual$/i.test(s.name));
  if (!monthly || !annual) throw new SourceError("The Census Bureau changed price_cust.xlsx (no 'Monthly' and 'Annual' sheets); this source needs updating.");
  const data = { monthly: readSheet(monthly.rows, true), annual: readSheet(annual.rows, false) };
  if (!data.monthly.some((p) => p.median !== null)) throw new SourceError("price_cust.xlsx holds no monthly median sales price; this source needs updating.");
  return data;
}

// ---------- the reading for one month ----------

export interface NrsReading {
  latest: NrsPoint;
  previous: NrsPoint | null;
  yearEarlier: NrsPoint | null;
  lastYear: NrsPoint | null;
  series: NrsPoint[];
}

export function monthShift(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function readLatest(data: NrsData): NrsReading {
  const usable = data.monthly.filter((p) => p.median !== null);
  const latest = usable[usable.length - 1];
  const find = (period: string) => usable.find((p) => p.period === period) ?? null;
  const lastYear = [...data.annual].reverse().find((p) => p.median !== null) ?? null;
  return {
    latest,
    previous: find(monthShift(latest.period, -1)),
    yearEarlier: find(monthShift(latest.period, -12)),
    lastYear,
    series: usable.slice(-12),
  };
}

export const changePercent = (now: number, then: number): number => Math.round(((now / then - 1) * 100) * 10) / 10;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (period: string): string => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
export const monthStart = (period: string): string => `${period}-01`;
export const monthEnd = (period: string): string => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// ---------- the answer ----------

const METHOD =
  "The Census Bureau's New Residential Sales survey: the median sales price of new privately-owned houses sold in the United States in the latest month the Bureau has published, from its own file price_cust.xlsx. " +
  "A published median, rounded by the Bureau to the nearest hundred dollars; the percentage changes are calculated by ProofPrice.";

export function nrsAnswer(r: NrsReading, o: { baseUrl?: string; publishedAt?: string | null; asked?: string }): PriceAnswer {
  const ref = r.latest.period;
  const notes: string[] = [
    "This is the national median for NEW houses sold, not for existing homes, and not for any state, city or ZIP code. For a town in Connecticut, New York City, Cook County IL or Washington, DC, name the town.",
  ];
  if (o.asked) notes.unshift(`The Census Bureau publishes no figure for ${o.asked} in this file; this is the national figure.`);
  const yoy = r.yearEarlier?.median ? changePercent(r.latest.median!, r.yearEarlier.median) : null;
  const mom = r.previous?.median ? changePercent(r.latest.median!, r.previous.median) : null;
  const extra: Record<string, unknown> = {
    geography: "United States",
    reference_month: ref,
    reference_period_label: monthWords(ref),
    property_kind: "new privately-owned houses sold",
    average_sales_price: r.latest.average,
    previous_month: r.previous ? { reference_period: r.previous.period, median: r.previous.median, change_percent: mom } : null,
    year_earlier: r.yearEarlier ? { reference_period: r.yearEarlier.period, median: r.yearEarlier.median, average: r.yearEarlier.average, change_percent: yoy } : null,
    last_full_year: r.lastYear ? { year: r.lastYear.period, median: r.lastYear.median, average: r.lastYear.average } : null,
    series: r.series.map((p) => ({ reference_period: p.period, median: p.median, average: p.average })),
    definition: "Median sales price of new privately-owned houses sold, United States, in dollars (Census Bureau New Residential Sales). Newest months are preliminary and revised.",
    file: FILE_URL,
    ...(o.publishedAt ? { published: o.publishedAt } : {}),
  };
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "US", town: "United States", property_type: "new" },
    value: r.latest.median,
    measure: "median",
    currency: "USD",
    unit: "per home",
    period: { from: monthStart(ref), to: monthEnd(ref) },
    reference_period: ref,
    method: METHOD,
    note: notes.join(" "),
    describe: (v) =>
      `The median sales price of new houses sold in the United States in ${monthWords(ref)} was ${fmtMoney(v, "USD")}` +
      (r.latest.average ? ` (average ${fmtMoney(r.latest.average, "USD")})` : "") +
      "." +
      (yoy !== null ? ` That is ${Math.abs(yoy)}% ${yoy >= 0 ? "above" : "below"} ${monthWords(r.yearEarlier!.period)} (${fmtMoney(r.yearEarlier!.median!, "USD")}).` : "") +
      (mom !== null ? ` Against ${monthWords(r.previous!.period)} it is ${mom >= 0 ? "up" : "down"} ${Math.abs(mom)}%.` : "") +
      " The newest month is preliminary and is revised by the Census Bureau.",
    baseUrl: o.baseUrl,
    extra,
    published: o.publishedAt ?? null,
  });
}

// ---------- fetching ----------

let cache: { at: number; data: NrsData; publishedAt: string | null } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

export async function download(url = FILE_URL, timeoutMs = 25000): Promise<{ buf: Buffer; publishedAt: string | null }> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new SourceError(`The Census Bureau file answered HTTP ${res.status}`);
  const lm = res.headers.get("last-modified");
  const t = lm ? Date.parse(lm) : NaN;
  return { buf: Buffer.from(await res.arrayBuffer()), publishedAt: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null };
}

async function load(): Promise<{ data: NrsData; publishedAt: string | null }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const { buf, publishedAt } = await retryOnce(() => download());
  const data = parseNrs(buf);
  cache = { at: Date.now(), data, publishedAt };
  return cache;
}
export function clearCache(): void {
  cache = null;
}

// ---------- the request ----------

const NATIONAL_NAMES = new Set(["us", "usa", "u s", "u s a", "united states", "united states of america", "america", "national", "nationwide", "the united states"]);
const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const blank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === "";

/** True when a US home-sales request explicitly asks for the country as a whole: the town is "United States" (or USA, national ...) or property_type is "new",
 *  with no ZIP, no state and no other town. A bare country=US stays with us-home-sales (which asks for a town), so that source's behaviour is unchanged. */
export function isNationalRequest(p: { town?: unknown; postcode?: unknown; state?: unknown; property_type?: unknown }): boolean {
  if (!blank(p.postcode) || !blank(p.state)) return false;
  const t = blank(p.property_type) ? "any" : fold(String(p.property_type));
  if (t !== "any" && t !== "new") return false;
  if (!blank(p.town)) return NATIONAL_NAMES.has(fold(String(p.town)));
  return t === "new";
}

export async function usNewHomeSales(
  input: { town?: string; postcode?: string; state?: string; property_type?: string; baseUrl?: string },
  load_: () => Promise<{ data: NrsData; publishedAt: string | null }> = load,
): Promise<PriceAnswer> {
  if (!isNationalRequest(input)) {
    throw new InputError("The Census Bureau's new-house price is national only. Ask with property_type new and no town, postcode or state (or town 'United States'), or name a town in Connecticut, New York City, Cook County IL or Washington, DC.");
  }
  const { data, publishedAt } = await load_();
  return nrsAnswer(readLatest(data), { baseUrl: input.baseUrl, publishedAt });
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the newest month's national median is stored as one row, dated by the last day of the reference month (referenceDates),
// n NO_COUNT (the file gives no record count). That copy keeps standing in for a live answer for 7 days after the last successful collection.

export function harvestFrom(data: NrsData): HarvestResult {
  const r = readLatest(data);
  const v = r.latest.median!;
  return {
    date: monthEnd(r.latest.period),
    currency: "USD",
    unit: "per home",
    rows: [{ area: NATIONAL, item: HARVEST_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v }],
    note: `Census Bureau New Residential Sales, median sales price of new houses sold, ${monthWords(r.latest.period)}: ${v} USD. A published median, not a count of records (the file gives no count).`,
  };
}

export async function usNewHomeHarvest(): Promise<HarvestResult> {
  const { buf } = await retryOnce(() => download(FILE_URL, 60000));
  return harvestFrom(parseNrs(buf));
}

/** Library key for a request: the national row. Null when the request is not the national question. */
export function usNewHomeHistoryKey(p: { town?: string; postcode?: string; state?: string; property_type?: string }): { area: string; item: string; label: string } | null {
  return isNationalRequest(p) ? { area: NATIONAL, item: HARVEST_ITEM, label: "United States, new houses" } : null;
}
