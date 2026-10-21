// Germany/Luxembourg wholesale power: SMARD (Bundesnetzagentur) day-ahead auction prices, hourly, filter 4169, region DE.
// Format checked live on 2026-10-17 from GitHub's servers (probe) : 
//   https://www.smard.de/app/chart_data/4169/DE/index_hour.json  -> {"timestamps":[ms, ...]} (start of each week, ms since epoch, newest last)
//   https://www.smard.de/app/chart_data/4169/DE/4169_DE_hour_<ts>.json -> {"meta_data":{...},"series":[[ms, EUR/MWh | null], ...]} hourly, null = not yet published.
// One request reads the 6 KB index and 1-3 week files (about 6 KB each), so no bulk download and no library is needed to answer.
// The collector (harvest) also stores yesterday's hourly aggregate so the history tool can switch on.

import { SourceError, fetchJson, retryOnce } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { BackfillResult, DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const BASE = "https://www.smard.de/app/chart_data/4169/DE";
export const INDEX_URL = `${BASE}/index_hour.json`;
export const weekUrl = (ts: number) => `${BASE}/4169_DE_hour_${ts}.json`;
export const LICENCE_URL = "https://www.smard.de/en/datennutzung";

export const INFO: SourceInfo = {
  id: "de-smard",
  country: "DE (Germany and Luxembourg bidding zone)",
  category: "wholesale electricity (day-ahead)",
  name: "SMARD market data: day-ahead wholesale electricity price, Germany/Luxembourg",
  publisher: "Bundesnetzagentur | SMARD.de",
  what_is_recorded:
    "The hourly day-ahead auction price of electricity in the Germany/Luxembourg bidding zone, in euro per MWh: the price at which the power exchange cleared the next-day hourly contracts.",
  price_type: "transaction",
  freshness: "Hourly prices, published the day before delivery (around 13:00 Central European Time); ProofPrice reads them on each request (cached up to 30 minutes)",
  licence: "CC BY 4.0 (SMARD data use page: data may be used freely with the credit \"Bundesnetzagentur | SMARD.de\")",
  licence_url: LICENCE_URL,
  attribution: "Source: Bundesnetzagentur | SMARD.de. Licensed under CC BY 4.0. Medians, ranges and counts are own calculations by ProofPrice from the hourly prices.",
  homepage: "https://www.smard.de/en",
  limits:
    "Wholesale exchange prices, not retail: a household or business bill adds grid fees, taxes, levies and supplier margin. One price per hour for the whole Germany/Luxembourg zone (no region or town). " +
    "Prices can be negative when there is more supply than demand. Day-ahead only; intraday and futures markets are not included. The record count is hours, not separate trades.",
};

export interface Point {
  ts: number; // ms since epoch, start of the hour
  price: number; // EUR per MWh
}

/** The week start timestamps of index_hour.json, oldest first. Throws SourceError when the layout is not the one we know. */
export function parseIndex(json: any): number[] {
  const t = json?.timestamps;
  if (!Array.isArray(t) || t.length === 0 || t.some((x: any) => typeof x !== "number")) {
    throw new SourceError("SMARD changed the layout of its index file (expected {\"timestamps\":[...]}); this source needs updating.");
  }
  return [...t].sort((a: number, b: number) => a - b);
}

/** The published (non-null) hourly prices of one week file, oldest first. */
export function parseSeries(json: any): Point[] {
  const s = json?.series;
  if (!Array.isArray(s)) throw new SourceError("SMARD changed the layout of its price file (expected {\"series\":[[ms, price],...]}); this source needs updating.");
  const out: Point[] = [];
  for (const row of s) {
    if (!Array.isArray(row) || typeof row[0] !== "number") continue;
    if (typeof row[1] !== "number" || !Number.isFinite(row[1])) continue; // null = not published yet
    out.push({ ts: row[0], price: row[1] });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Median and 10th-90th percentile of prices that may be negative (the shared summarise() drops values <= 0). */
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

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoHour = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const HOUR = 3600000;
const DAY = 86400000;

export type Getter = (url: string) => Promise<any>;
const defaultGet: Getter = (url) => retryOnce(() => fetchJson(url, {}, 9000));

/** Week files that can hold hours in [fromMs, toMs]. Each file starts at a week start and holds 7 days. */
export function weeksFor(weekStarts: number[], fromMs: number, toMs: number): number[] {
  return weekStarts.filter((w) => w <= toMs && w + 7 * DAY > fromMs);
}

export async function loadPoints(fromMs: number, toMs: number, get: Getter = defaultGet): Promise<Point[]> {
  const starts = parseIndex(await get(INDEX_URL));
  const weeks = weeksFor(starts, fromMs, toMs);
  if (weeks.length === 0) return [];
  const files = await Promise.all(weeks.map((w) => get(weekUrl(w))));
  const pts = files.flatMap((f) => parseSeries(f)).filter((p) => p.ts >= fromMs && p.ts < toMs);
  // De-duplicate by hour (week files do not overlap, but be safe).
  return [...new Map(pts.map((p) => [p.ts, p])).values()].sort((a, b) => a.ts - b.ts);
}

export function answerFromPoints(pts: Point[], opts: { days: number; baseUrl?: string }): PriceAnswer {
  const s = summariseSigned(pts.map((p) => p.price));
  const last = pts[pts.length - 1];
  const negHours = pts.filter((p) => p.price < 0).length;
  const lastDay = last ? pts.filter((p) => p.ts >= last.ts - 23 * HOUR) : [];
  const dayAvg = lastDay.length >= 5 ? r2(lastDay.reduce((a, p) => a + p.price, 0) / lastDay.length) : null;
  const cheapest = pts.length ? pts.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const dearest = pts.length ? pts.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: "DE", market: "day-ahead", days: opts.days },
    summary: s,
    currency: "EUR",
    unit: "per MWh",
    period: pts.length ? { from: isoDay(pts[0].ts), to: isoDay(last.ts) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the hourly day-ahead auction prices (euro per MWh) for Germany/Luxembourg over the last ${opts.days} day(s), ` +
      "as published by the Bundesnetzagentur on SMARD. Each hour counts as one record. Wholesale exchange prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale day-ahead electricity in Germany/Luxembourg: median ${x.median} EUR/MWh (${r2(x.median / 10)} cents/kWh), typical hours between ${x.low} and ${x.high} EUR/MWh over the last ${opts.days} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_hour: last ? { time_utc: isoHour(last.ts), eur_per_mwh: last.price } : null,
          latest_24h_average_eur_per_mwh: dayAvg,
          cheapest_hour: cheapest ? { time_utc: isoHour(cheapest.ts), eur_per_mwh: cheapest.price } : null,
          dearest_hour: dearest ? { time_utc: isoHour(dearest.ts), eur_per_mwh: dearest.price } : null,
          negative_price_hours: negHours,
          bidding_zone: "DE-LU",
          basis: "Wholesale day-ahead exchange price; household bills add grid fees, taxes and margin.",
        }
      : undefined,
  });
}

export async function smardDayAhead(input: { days?: number; baseUrl?: string }, get: Getter = defaultGet, now: Date = new Date()): Promise<PriceAnswer> {
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const to = now.getTime();
  const pts = await loadPoints(to - days * DAY, to, get);
  if (pts.length === 0) throw new SourceError("SMARD returned no published hourly prices for the period; the source may be updating.");
  return answerFromPoints(pts, { days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_AREA = "DE";
export const HISTORY_ITEM = "day-ahead";

/** One library row from a day's hourly prices (needs 20+ of 24 hours). */
export function dayRow(pts: Point[]): DailyRow | null {
  const s = summariseSigned(pts.map((p) => p.price));
  if (!s || s.count < 20) return null;
  return { area: HISTORY_AREA, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's (UTC) 24 hourly prices as one aggregate row. */
export async function smardHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const dayStart = Date.parse(isoDay(now.getTime() - DAY) + "T00:00:00Z");
  const pts = await loadPoints(dayStart, dayStart + DAY, get);
  const row = dayRow(pts);
  if (!row) throw new SourceError(`SMARD: only ${pts.length} hourly prices for ${isoDay(dayStart)}, expected 24.`);
  return {
    date: isoDay(dayStart),
    currency: "EUR",
    unit: "per MWh",
    rows: [row],
    note: "SMARD day-ahead hourly prices, Germany/Luxembourg, one UTC day (24 hours). Bundesnetzagentur | SMARD.de, CC BY 4.0.",
  };
}

export function smardHistoryKey(): { area: string; item: string; label: string } {
  return { area: HISTORY_AREA, item: HISTORY_ITEM, label: "Germany/Luxembourg day-ahead wholesale power" };
}

// ---------- history backfill (monthly) ----------
// SMARD keeps the hourly Germany/Luxembourg series from 2018-10-01 (index_hour.json starts there, probed 2026-10-21), one 7-day file per week.
// Each month becomes ONE row: median / 10th-90th percentile / min / max of its hourly prices, n = hours. A month needs 90% of its hours.

export const MIN_MONTH_COVERAGE = 0.9;

const monthHours = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return (Date.UTC(y, mo, 1) - Date.UTC(y, mo - 1, 1)) / HOUR;
};

/** Monthly aggregate rows from hourly points (any order). Months outside [fromMonth, toMonth] or with thin coverage are left out. */
export function monthlyPeriods(pts: Point[], fromMonth: string, toMonth: string): BackfillResult["periods"] {
  const byMonth = new Map<string, Map<number, number>>();
  for (const p of pts) {
    const m = new Date(p.ts).toISOString().slice(0, 7);
    if (m < fromMonth || m > toMonth) continue;
    const h = byMonth.get(m) ?? new Map<number, number>();
    h.set(p.ts, p.price); // de-duplicates by hour
    byMonth.set(m, h);
  }
  const out: BackfillResult["periods"] = [];
  for (const m of [...byMonth.keys()].sort()) {
    const vals = [...byMonth.get(m)!.values()];
    if (vals.length < MIN_MONTH_COVERAGE * monthHours(m)) continue;
    const s = summariseSigned(vals);
    if (!s) continue;
    out.push({ period: m, rows: [{ area: HISTORY_AREA, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max }] });
  }
  return out;
}

export async function smardBackfill(from: string, to: string, get: Getter = defaultGet, pauseMs = 250): Promise<BackfillResult> {
  const fromMs = Date.parse(from.slice(0, 7) + "-01T00:00:00Z");
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const toMs = Date.UTC(ty, tm, 1); // first instant after the last month
  const starts = parseIndex(await get(INDEX_URL));
  const weeks = weeksFor(starts, fromMs, toMs);
  if (!weeks.length) throw new SourceError("SMARD lists no hourly week files for the requested range.");
  const pts: Point[] = [];
  let failed = 0;
  for (const w of weeks) {
    try {
      pts.push(...parseSeries(await get(weekUrl(w))).filter((p) => p.ts >= fromMs && p.ts < toMs));
    } catch (e) {
      failed++;
      console.log(`skipped week ${isoDay(w)}: ${(e as Error).message}`);
      if (failed > 10) throw new SourceError("SMARD: more than 10 week files failed; stopping.");
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  const periods = monthlyPeriods(pts, from.slice(0, 7), to.slice(0, 7));
  console.log(`week files: ${weeks.length} (failed ${failed}); hours: ${pts.length}; months: ${periods.length}`);
  return {
    currency: "EUR",
    unit: "per MWh",
    periods,
    note:
      "SMARD day-ahead hourly prices, Germany/Luxembourg bidding zone, monthly figures (UTC months): median and 10th-90th percentile of the hourly prices, n = hours (at least 90% of the month). " +
      "The hourly archive starts in October 2018. Wholesale exchange prices, not retail. Bundesnetzagentur | SMARD.de, CC BY 4.0.",
  };
}
