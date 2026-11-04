// Romania wholesale power: OPCOM (Romanian power exchange) Day-Ahead Market coupling results, 15-minute prices in EUR per MWh.
// Format checked live on 2026-11-04 from GitHub's servers (probe opcom-csv), no key, no cookie needed:
//   GET https://www.opcom.ro/rapoarte-pzu-raportMarketResults-export-csv/3/11/2026/en   (day/month/year, NO zero padding)
//   200, header "Content-disposition: csv; filename=MarketCouplingResults_11/3/2026.csv", Content-Type says text/html but the body is CSV (CRLF):
//     Market Coupling Results: 11/3/2026            <- month/day/year
//     "DAM INDEX" / "RO","Prices (EUR/MWh)","Change (%)" / "ROPEX_DAM_Base","297.00","-4.20" / ROPEX_DAM_Peak,322.22,-6.29 / ROPEX_DAM_Off_Peak,278.09,-2.32
//     Interval,Price RO(EUR/MWh),Cross-Border flow (MW),,Available Transfer Capacity [MW],
//     ,,RO_HU,HU_RO,RO_BG,BG_RO,RO_BG,BG_RO
//     1,228.95,0.0,1149.4,... (96 rows of 15-minute intervals; 92 or 100 on the days the clocks change)
// Next-day prices appear around 13:00 CET. The publisher's licence page was NOT readable (disclaimer answered 403): free tier only.

import { SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const BASE = "https://www.opcom.ro/rapoarte-pzu-raportMarketResults-export-csv";
export const HOMEPAGE = "https://www.opcom.ro/";

export const INFO: SourceInfo = {
  id: "ro-opcom-power",
  country: "RO",
  category: "wholesale electricity (day-ahead market)",
  name: "OPCOM Day-Ahead Market results (Romania)",
  publisher: "OPCOM (Operatorul Pietei de Energie Electrica si de Gaze Naturale), Romanian power exchange",
  what_is_recorded:
    "The market-coupling clearing price of the Romanian bidding zone on the day-ahead electricity market for each 15-minute delivery interval, in euro per MWh, plus the ROPEX day-ahead index (base, peak, off-peak).",
  price_type: "transaction",
  freshness: "The next day's prices are published around 13:00 CET each day; read on each request (cached up to 30 minutes)",
  licence: "OPCOM website terms (licence text not readable by our checker: free tier only)",
  licence_url: "https://www.opcom.ro/disclaimer/133/en",
  attribution: "Source: OPCOM S.A. (www.opcom.ro), Day-Ahead Market results. Medians, ranges and counts are own calculations by ProofPrice; OPCOM does not endorse them.",
  homepage: HOMEPAGE,
  limits:
    "Wholesale exchange prices in euro per MWh, not retail: a household or business bill adds network charges, taxes, levies and supplier margin. One price for the whole Romanian zone. " +
    "The record count is 15-minute intervals (96 a day), not separate trades. Prices can be negative. Days not yet published are skipped.",
};

export interface DayPrices {
  /** ISO date of delivery (from the date we asked for, cross-checked with the file's own title). */
  date: string;
  prices: number[]; // EUR per MWh, one per 15-minute interval, in order
  ropex: { base: number | null; peak: number | null; offPeak: number | null };
}

const DAY = 86400000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function dayUrl(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${BASE}/${d}/${m}/${y}/en`;
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const v = Number(s.replace(/"/g, "").trim());
  return s.trim() !== "" && Number.isFinite(v) ? v : null;
}

/** Parse one day's CSV. Throws SourceError when the layout is not the one we checked. */
export function parseMarketResults(text: string, date: string): DayPrices {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const title = /^Market Coupling Results:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(lines[0] ?? "");
  const head = lines.findIndex((l) => /^Interval,\s*Price RO/i.test(l));
  if (!title || head < 0) throw new SourceError("OPCOM changed the layout of the market results file (no title or price header); this source needs updating.");
  const [y, m, d] = date.split("-").map(Number);
  if (Number(title[1]) !== m || Number(title[2]) !== d || Number(title[3]) !== y) {
    throw new SourceError(`OPCOM returned results for ${title[0].slice(24).trim()} when ${date} was asked (month/day/year); this source needs checking.`);
  }
  const ropex = { base: null as number | null, peak: null as number | null, offPeak: null as number | null };
  for (const l of lines.slice(1, head)) {
    const c = l.split(",");
    const key = c[0].replace(/"/g, "").trim();
    if (key === "ROPEX_DAM_Base") ropex.base = num(c[1]);
    else if (key === "ROPEX_DAM_Peak") ropex.peak = num(c[1]);
    else if (key === "ROPEX_DAM_Off_Peak") ropex.offPeak = num(c[1]);
  }
  const prices: number[] = [];
  for (const l of lines.slice(head + 1)) {
    if (!/^\d+,/.test(l)) continue; // sub-header and blank lines
    const c = l.split(",");
    const price = num(c[1]);
    if (Number(c[0]) !== prices.length + 1 || price === null) {
      throw new SourceError("OPCOM changed the layout of the price rows (interval number, price); this source needs updating.");
    }
    prices.push(price);
  }
  if (![92, 96, 100].includes(prices.length)) {
    throw new SourceError(`OPCOM file for ${date} has ${prices.length} intervals (expected 92, 96 or 100); the day may be incomplete.`);
  }
  return { date, prices, ropex };
}

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

export type Getter = (url: string) => Promise<string>;

export const defaultGet: Getter = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/csv,*/*", "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
};

export async function loadDay(date: string, get: Getter = defaultGet): Promise<DayPrices> {
  return parseMarketResults(await get(dayUrl(date)), date);
}

/** The published days from `days` days back up to tomorrow (tomorrow appears around 13:00 CET). Unpublished days are skipped. */
export async function loadDays(days: number, now: Date, get: Getter = defaultGet): Promise<DayPrices[]> {
  const today = Date.parse(isoDay(now.getTime()) + "T00:00:00Z");
  const dates: string[] = [];
  for (let i = days; i >= -1; i--) dates.push(isoDay(today - i * DAY));
  const out: DayPrices[] = [];
  let outage: unknown = null;
  for (let i = 0; i < dates.length; i += 5) {
    const chunk = await Promise.all(
      dates.slice(i, i + 5).map((d) =>
        loadDay(d, get).catch((e) => {
          if (d !== dates[dates.length - 1]) outage = e; // tomorrow is often not published yet: not an outage
          return null;
        }),
      ),
    );
    for (const c of chunk) if (c) out.push(c);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  if (out.length === 0 && outage) throw outage;
  return out;
}

export function answerFromDays(ds: DayPrices[], opts: { days: number; baseUrl?: string }): PriceAnswer {
  const all = ds.flatMap((d) => d.prices);
  const s = summariseSigned(all);
  const last = ds[ds.length - 1];
  const lastAvg = last ? r2(last.prices.reduce((a, b) => a + b, 0) / last.prices.length) : null;
  let cheapest: { date: string; interval: number; v: number } | null = null;
  let dearest: { date: string; interval: number; v: number } | null = null;
  for (const d of ds) {
    d.prices.forEach((v, i) => {
      if (!cheapest || v < cheapest.v) cheapest = { date: d.date, interval: i + 1, v };
      if (!dearest || v > dearest.v) dearest = { date: d.date, interval: i + 1, v };
    });
  }
  const c = cheapest as { date: string; interval: number; v: number } | null;
  const dr = dearest as { date: string; interval: number; v: number } | null;
  const neg = all.filter((v) => v < 0).length;
  return buildAnswer({
    source: INFO,
    query: { country: "RO", market: "day-ahead", days: opts.days },
    summary: s,
    currency: "EUR",
    unit: "per MWh",
    period: ds.length ? { from: ds[0].date, to: last.date } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the 15-minute day-ahead clearing price (euro per MWh) of the Romanian zone over the last ${opts.days} day(s) plus the next day when already published, ` +
      "from the OPCOM Day-Ahead Market coupling results. Each 15-minute interval counts as one record. Wholesale exchange prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale day-ahead electricity in Romania: median ${x.median} EUR/MWh (${r2(x.median / 10)} cents/kWh), typical 15-minute intervals between ${x.low} and ${x.high} EUR/MWh over ${ds.length} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_day: last.date,
          latest_day_average_eur_per_mwh: lastAvg,
          ropex_latest_day_eur_per_mwh: { base: last.ropex.base, peak: last.ropex.peak, off_peak: last.ropex.offPeak },
          cheapest_interval: c ? { date: c.date, interval: c.interval, eur_per_mwh: r2(c.v) } : null,
          dearest_interval: dr ? { date: dr.date, interval: dr.interval, eur_per_mwh: r2(dr.v) } : null,
          negative_price_intervals: neg,
          basis: "Wholesale day-ahead exchange price (OPCOM, Romanian zone, 15-minute intervals); household bills add network charges, levies, taxes and margin. Interval 1 starts at 00:00 Romanian time.",
        }
      : undefined,
  });
}

export async function opcomSpot(input: { days?: number; baseUrl?: string }, get: Getter = defaultGet, now: Date = new Date()): Promise<PriceAnswer> {
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const ds = await loadDays(days, now, get);
  if (ds.length === 0) throw new SourceError("OPCOM returned no day-ahead prices for the period; the source may be updating.");
  return answerFromDays(ds, { days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_ITEM = "day-ahead";

/** One library row from a day's 15-minute prices (needs 92+ of 96 intervals). */
export function dayRow(area: string, d: DayPrices): DailyRow | null {
  const s = summariseSigned(d.prices);
  if (!s || s.count < 92) return null;
  return { area, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's delivery day. */
export async function opcomHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const date = isoDay(now.getTime() - DAY);
  const d = await loadDay(date, get);
  const row = dayRow("RO", d);
  if (!row) throw new SourceError(`OPCOM: too few intervals for ${date} (${d.prices.length}).`);
  return {
    date,
    currency: "EUR",
    unit: "per MWh",
    rows: [row],
    note: "OPCOM Day-Ahead Market clearing price, Romanian zone, 15-minute intervals of one delivery day. Source: OPCOM S.A.",
  };
}

export function opcomHistoryKey(country: string): { area: string; item: string; label: string } | null {
  if (country.toUpperCase() !== "RO") return null;
  return { area: "RO", item: HISTORY_ITEM, label: "Romania day-ahead wholesale power (OPCOM, EUR per MWh)" };
}
