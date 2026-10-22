// Australia wholesale power: AEMO National Electricity Market (NEM) regional reference prices, 5-minute spot price per region.
// Format checked live on 2026-10-22 from GitHub's servers (probe):
//   GET https://nemweb.com.au/Reports/CURRENT/Public_Prices/            -> HTML directory listing, one link per day:
//        /Reports/CURRENT/Public_Prices/PUBLIC_PRICES_202610210000_20261022040503.zip   (about 260 KB, one file per trading day, ~60 days kept)
//   The zip holds one CSV in AEMO's MMS layout: "C" comment line, "I,DREGION,..." header, then "D,DREGION,,2,<SETTLEMENTDATE>,<RUNNO>,<REGIONID>,<INTERVENTION>,<RRP>,..."
//   rows, NOT in time order: 288 five-minute intervals x 5 regions (NSW1 QLD1 SA1 TAS1 VIC1). SETTLEMENTDATE is NEM time (AEST, UTC+10, no daylight saving),
//   "2026/10/21 08:00:00" is the interval ending at 08:00. A file named ..._202610210000_... holds the trading day that starts 04:05 on 2026/10/21 and ends 04:00 on 2026/10/22.
//   RRP = regional reference price, AUD per MWh (it can be negative, and rises to the market price cap in a shortage).
// Licence (read 2026-10-22, https://aemo.com.au/privacy-and-legal-notices/copyright-permissions): "AEMO confirms its general permission for anyone to use
//   AEMO Material for any purpose ... but only with accurate and appropriate attribution of the relevant AEMO Material and AEMO as its author."

import { inflateRawSync } from "node:zlib";
import { SourceError, InputError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { BackfillResult, DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const BASE = "https://nemweb.com.au";
export const LIST_URL = `${BASE}/Reports/CURRENT/Public_Prices/`;
export const LICENCE_URL = "https://aemo.com.au/privacy-and-legal-notices/copyright-permissions";

export const REGIONS: Record<string, { label: string; aliases: string[] }> = {
  NSW1: { label: "New South Wales (incl. the ACT)", aliases: ["nsw", "new south wales", "act", "sydney"] },
  QLD1: { label: "Queensland", aliases: ["qld", "queensland", "brisbane"] },
  SA1: { label: "South Australia", aliases: ["sa", "south australia", "adelaide"] },
  TAS1: { label: "Tasmania", aliases: ["tas", "tasmania", "hobart"] },
  VIC1: { label: "Victoria", aliases: ["vic", "victoria", "melbourne"] },
};
export const DEFAULT_REGION = "NSW1";
export const HISTORY_ITEM = "spot-5min";

export const INFO: SourceInfo = {
  id: "au-aemo-power",
  country: "AU",
  category: "wholesale electricity (spot)",
  name: "AEMO: National Electricity Market regional spot prices (5-minute)",
  publisher: "Australian Energy Market Operator (AEMO)",
  what_is_recorded:
    "The regional reference price (RRP) of electricity in one NEM region, in Australian dollars per MWh, for each five-minute dispatch interval: the price at which the market cleared that interval.",
  price_type: "transaction",
  freshness: "AEMO publishes one price file per trading day (04:00 to 04:00 NEM time) early the next morning; ProofPrice reads the files of the last days on each request (cached up to 30 minutes)",
  licence: "AEMO general permission: anyone may use AEMO Material for any purpose with accurate and appropriate attribution of the material and AEMO as its author",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Australian Energy Market Operator (AEMO), NEM regional reference prices. Used under AEMO's general copyright permission with attribution. Medians, ranges and counts are own calculations by ProofPrice from the five-minute prices.",
  homepage: "https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem",
  limits:
    "Wholesale spot prices per NEM region (NSW incl. ACT, QLD, SA, TAS, VIC), not what households or businesses pay on bills: retail tariffs add network charges, environmental costs and retailer margin. " +
    "Western Australia and the Northern Territory are not in the NEM and are not covered. Prices are in Australian dollars per MWh and can be negative. The record count is five-minute intervals, not separate trades. Times are NEM time (UTC+10).",
};

export interface Interval {
  /** NEM time of the interval end as written by AEMO, "YYYY-MM-DD HH:MM". */
  at: string;
  region: string;
  price: number; // AUD per MWh
}

// ---------- zip + csv ----------

/** Read the first (only) file of a zip archive. Uses the central directory, so it also works when the local header has no sizes. */
export function unzipFirst(buf: Buffer): { name: string; data: Buffer } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("AEMO price file is not a zip archive; the file layout may have changed.");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("AEMO price zip has an unexpected layout.");
  const method = buf.readUInt16LE(cd + 10);
  const compSize = buf.readUInt32LE(cd + 20);
  const nameLen = buf.readUInt16LE(cd + 28);
  const local = buf.readUInt32LE(cd + 42);
  const name = buf.subarray(cd + 46, cd + 46 + nameLen).toString("utf8");
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new SourceError("AEMO price zip has an unexpected layout.");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const raw = buf.subarray(start, start + compSize);
  if (method === 0) return { name, data: Buffer.from(raw) };
  if (method !== 8) throw new SourceError(`AEMO price zip uses compression method ${method}, which we do not read.`);
  return { name, data: inflateRawSync(raw) };
}

const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));

/** All five-minute regional prices of one AEMO PUBLIC_PRICES csv. Keeps INTERVENTION 0 rows only and, if an interval has several runs, the highest RUNNO. */
export function parsePublicPrices(csv: string): Interval[] {
  const lines = csv.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("I,DREGION,"));
  if (!header) throw new SourceError('AEMO changed the layout of its price file (no "I,DREGION" header line); this source needs updating.');
  const cols = header.split(",");
  const iDate = cols.indexOf("SETTLEMENTDATE");
  const iRun = cols.indexOf("RUNNO");
  const iReg = cols.indexOf("REGIONID");
  const iInt = cols.indexOf("INTERVENTION");
  const iRrp = cols.indexOf("RRP");
  if ([iDate, iRun, iReg, iInt, iRrp].some((i) => i < 0)) {
    throw new SourceError("AEMO changed the columns of its price file (SETTLEMENTDATE, RUNNO, REGIONID, INTERVENTION or RRP missing); this source needs updating.");
  }
  const best = new Map<string, { run: number; iv: Interval }>();
  for (const line of lines) {
    if (!line.startsWith("D,DREGION,")) continue;
    const f = line.split(","); // the first 9 columns never hold a comma (the date is quoted but has none)
    if (f[iInt] !== "0") continue;
    const m = f[iDate]?.replace(/"/g, "").match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}):\d{2}$/);
    const price = num(f[iRrp]);
    const region = f[iReg];
    if (!m || !Number.isFinite(price) || !region) continue;
    const at = `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
    const run = num(f[iRun]) || 0;
    const k = `${region}|${at}`;
    const cur = best.get(k);
    if (!cur || run > cur.run) best.set(k, { run, iv: { at, region, price } });
  }
  if (best.size === 0) throw new SourceError("AEMO price file held no regional prices.");
  return [...best.values()].map((b) => b.iv).sort((a, b) => a.at.localeCompare(b.at) || a.region.localeCompare(b.region));
}

/** Links to the daily price zips in the directory page, oldest first. date = the trading day the file starts on (YYYY-MM-DD). */
export function parseListing(html: string): { date: string; path: string }[] {
  const out: { date: string; path: string }[] = [];
  for (const m of html.matchAll(/HREF="([^"]*PUBLIC_PRICES_(\d{4})(\d{2})(\d{2})0000_\d+\.zip)"/gi)) {
    out.push({ date: `${m[2]}-${m[3]}-${m[4]}`, path: m[1] });
  }
  if (out.length === 0) throw new SourceError("AEMO price directory listed no daily price files; the layout may have changed.");
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- fetching ----------

export interface Fetcher {
  text(url: string): Promise<string>;
  bytes(url: string): Promise<Buffer>;
}

async function rawGet(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export const liveFetcher: Fetcher = {
  text: async (url) => await (await rawGet(url, 9000)).text(),
  bytes: async (url) => Buffer.from(await (await rawGet(url, 12000)).arrayBuffer()),
};

export async function loadDay(f: Fetcher, path: string): Promise<Interval[]> {
  const zip = await f.bytes(path.startsWith("http") ? path : BASE + path);
  const { data } = unzipFirst(zip);
  return parsePublicPrices(data.toString("utf8"));
}

// ---------- statistics ----------

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Like lib/stats summarise, but negative and zero prices are kept: wholesale power can be free or negative. */
export function summariseSigned(values: number[]): PriceSummary | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return {
    count: clean.length,
    median: r2(percentile(clean, 0.5)),
    low: r2(percentile(clean, 0.1)),
    high: r2(percentile(clean, 0.9)),
    min: r2(clean[0]),
    max: r2(clean[clean.length - 1]),
  };
}

export function resolveRegion(region?: string): { code: string; label: string } {
  if (!region || !region.trim()) return { code: DEFAULT_REGION, label: REGIONS[DEFAULT_REGION].label };
  const k = region.trim().toLowerCase();
  for (const [code, r] of Object.entries(REGIONS)) {
    if (code.toLowerCase() === k || r.aliases.includes(k)) return { code, label: r.label };
  }
  throw new InputError(`AEMO region "${region}" is not available. Use one of ${Object.keys(REGIONS).join(", ")} (NSW1 includes the ACT). Western Australia and the Northern Territory are not in the National Electricity Market.`);
}

export const MAX_DAYS = 7;
export const DEFAULT_DAYS = 3;

export function answerFromIntervals(
  ivs: Interval[],
  opts: { region: string; regionLabel: string; days: number; baseUrl?: string },
): PriceAnswer {
  const sel = ivs.filter((i) => i.region === opts.region);
  const s = summariseSigned(sel.map((i) => i.price));
  const last = sel[sel.length - 1];
  const neg = sel.filter((i) => i.price < 0).length;
  const lo = sel.length ? sel.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const hi = sel.length ? sel.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const day = (at: string) => at.slice(0, 10);
  return buildAnswer({
    source: INFO,
    query: { country: "AU", region: opts.region, market: "spot", days: opts.days },
    summary: s,
    currency: "AUD",
    unit: "per MWh",
    period: sel.length ? { from: day(sel[0].at), to: day(last.at) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the five-minute regional reference prices (Australian dollars per MWh) for ${opts.regionLabel} (${opts.region}) over the last ${opts.days} trading day(s), ` +
      "from AEMO's daily price files. Each five-minute interval counts as one record. Wholesale spot prices, not retail bills. Negative prices are kept. Times are NEM time (UTC+10).",
    describe: (x) =>
      `Wholesale spot electricity in ${opts.regionLabel} (${opts.region}): median ${x.median} AUD/MWh (${r2(x.median / 10)} cents/kWh), typical five-minute prices between ${x.low} and ${x.high} AUD/MWh over the last ${opts.days} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_interval: last ? { nem_time: last.at, aud_per_mwh: r2(last.price) } : null,
          cheapest_interval: lo ? { nem_time: lo.at, aud_per_mwh: r2(lo.price) } : null,
          dearest_interval: hi ? { nem_time: hi.at, aud_per_mwh: r2(hi.price) } : null,
          negative_price_intervals: neg,
          nem_region: opts.region,
          default_region_used: opts.region === DEFAULT_REGION,
          basis: "AEMO regional reference price (RRP), five-minute spot market; household bills add network charges, environmental costs and retailer margin.",
          note_region: "Prices differ by NEM region: choose region=NSW1, QLD1, SA1, TAS1 or VIC1. NSW1 is the default.",
        }
      : undefined,
  });
}

export async function aemoSpot(
  input: { region?: string; days?: number; baseUrl?: string },
  f: Fetcher = liveFetcher,
): Promise<PriceAnswer> {
  const reg = resolveRegion(input.region);
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(input.days ?? DEFAULT_DAYS)));
  const files = parseListing(await f.text(LIST_URL)).slice(-days);
  const parts = await Promise.all(files.map((x) => loadDay(f, x.path)));
  const ivs = parts.flat();
  if (ivs.length === 0) throw new SourceError("AEMO returned no published prices for the period; the source may be updating.");
  return answerFromIntervals(ivs, { region: reg.code, regionLabel: reg.label, days: files.length, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

/** One library row per region from one trading day's five-minute prices (a full day has 288; fewer than 250 is skipped as incomplete). */
export function dayRows(ivs: Interval[]): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const code of Object.keys(REGIONS)) {
    const s = summariseSigned(ivs.filter((i) => i.region === code).map((i) => i.price));
    if (!s || s.count < 250) continue;
    rows.push({ area: code, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows;
}

/** The newest complete trading day in the directory (the last file). */
export async function aemoHarvest(f: Fetcher = liveFetcher): Promise<HarvestResult> {
  const files = parseListing(await f.text(LIST_URL));
  const last = files[files.length - 1];
  const rows = dayRows(await loadDay(f, last.path));
  if (rows.length === 0) throw new SourceError(`AEMO: the trading day ${last.date} was incomplete for every region.`);
  return {
    date: last.date,
    currency: "AUD",
    unit: "per MWh",
    rows,
    note: "AEMO NEM regional reference prices, one trading day (04:05 to 04:00 NEM time, UTC+10), five-minute intervals, per region. Used under AEMO's general copyright permission with attribution.",
  };
}

/** Past trading days from the files still on the AEMO server (about two months). */
export async function aemoBackfill(from: string, to: string, f: Fetcher = liveFetcher): Promise<BackfillResult> {
  const files = parseListing(await f.text(LIST_URL)).filter((x) => x.date >= from && x.date <= to);
  const periods = [];
  for (const x of files) {
    const rows = dayRows(await loadDay(f, x.path));
    if (rows.length) periods.push({ period: x.date, rows });
  }
  return { currency: "AUD", unit: "per MWh", periods, note: "AEMO daily price files still published on nemweb.com.au (about the last two months)." };
}

export function aemoHistoryKey(region?: string): { area: string; item: string; label: string } | null {
  try {
    const r = resolveRegion(region);
    return { area: r.code, item: HISTORY_ITEM, label: `${r.label} (${r.code}) wholesale spot power` };
  } catch {
    return null;
  }
}
