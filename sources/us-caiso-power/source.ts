// California wholesale power: CAISO OASIS day-ahead market (DAM) hourly locational marginal prices (LMP) at the three trading hubs,
// USD per MWh. Format checked live on 2026-11-12 from the cloud workspace (HTTP 200, no key, no cookie):
//   GET https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=20261105T08:00-0000&enddatetime=20261112T08:00-0000
//       &version=1&market_run_id=DAM&node=TH_NP15_GEN-APND&resultformat=6
//   -> a ZIP holding ONE csv. Header: INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,OPR_DT,OPR_HR,OPR_INTERVAL,NODE_ID_XML,NODE_ID,NODE,
//      MARKET_RUN_ID,LMP_TYPE,XML_DATA_ITEM,PNODE_RESMRID,GRP_TYPE,POS,MW,GROUP. Five rows per hour (LMP_TYPE = LMP, MCC, MCE, MCL, MGHG),
//      unsorted. The total price is the row with LMP_TYPE=LMP; the column named MW holds USD per MWh (not megawatts).
//   If a query has no data the ZIP holds an XML error instead of a CSV. The publisher's terms page was NOT readable: free tier only.
// The API asks for one request every few seconds: one call per hub, never one per hour.

import { inflateRawSync } from "node:zlib";
import { SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const BASE = "https://oasis.caiso.com/oasisapi/SingleZip";
export const HOMEPAGE = "https://www.caiso.com/";

export const INFO: SourceInfo = {
  id: "us-caiso-power",
  country: "US",
  category: "wholesale electricity (day-ahead market, California)",
  name: "CAISO OASIS day-ahead market prices (California)",
  publisher: "California Independent System Operator (CAISO), OASIS",
  what_is_recorded:
    "The day-ahead market locational marginal price (LMP) of electricity at a CAISO trading hub (NP15 north, SP15 south, ZP26 centre) for each delivery hour, in US dollars per MWh.",
  price_type: "transaction",
  freshness: "The next day's prices are published around 13:00 Pacific each day; read on each request (cached up to 30 minutes)",
  licence: "CAISO website terms (licence text not readable by our checker: free tier only)",
  licence_url: "https://www.caiso.com/",
  attribution: "Source: California ISO (CAISO) OASIS, day-ahead market LMP. Medians, ranges and counts are own calculations by ProofPrice; CAISO does not endorse them.",
  homepage: HOMEPAGE,
  limits:
    "Wholesale market prices in US dollars per MWh at one trading hub, not retail: a household or business bill adds delivery charges, taxes and supplier margin. California (CAISO area) only. " +
    "The record count is delivery hours (24 a day), not separate trades. Prices can be negative. Days not yet published are skipped.",
};

export type Hub = "NP15" | "SP15" | "ZP26";
export const HUBS: Hub[] = ["NP15", "SP15", "ZP26"];
export const DEFAULT_HUB: Hub = "NP15";
const HUB_LABEL: Record<Hub, string> = { NP15: "NP15 (northern California)", SP15: "SP15 (southern California)", ZP26: "ZP26 (central California)" };

/** Accepts NP15, sp15, "south", "north", "central", "TH_SP15_GEN-APND". Empty gives the default; anything else is an error. */
export function parseHub(raw: string | undefined | null): Hub {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return DEFAULT_HUB;
  for (const h of HUBS) if (s.includes(h)) return h;
  if (/NORTH/.test(s)) return "NP15";
  if (/SOUTH/.test(s)) return "SP15";
  if (/CENTRAL|MIDDLE/.test(s)) return "ZP26";
  throw new SourceError(`Unknown hub "${raw}". Use NP15 (north, default), SP15 (south) or ZP26 (central).`);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const DAY = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const stamp = (date: string) => `${date.replace(/-/g, "")}T08:00-0000`;

export function queryUrl(hub: Hub, fromDate: string, toDate: string): string {
  return `${BASE}?queryname=PRC_LMP&startdatetime=${stamp(fromDate)}&enddatetime=${stamp(toDate)}&version=1&market_run_id=DAM&node=TH_${hub}_GEN-APND&resultformat=6`;
}

/** Extract the first file of a ZIP held in memory (uses the central directory, so data descriptors are fine). */
export function unzipFirst(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("CAISO did not answer with a ZIP file; this source needs checking.");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("CAISO ZIP directory is not the layout we checked.");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new SourceError("CAISO ZIP entry is not the layout we checked.");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new SourceError("CAISO ZIP uses a compression method we do not read.");
}

export interface HourPrice { date: string; hour: number; price: number }

/** Parse the CSV inside the ZIP into one price per delivery hour (rows with LMP_TYPE=LMP), sorted. Throws SourceError on any layout change. */
export function parseLmp(text: string): HourPrice[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines[0] ?? "").split(",");
  const ix = (n: string) => head.indexOf(n);
  const iDate = ix("OPR_DT"), iHr = ix("OPR_HR"), iType = ix("LMP_TYPE"), iVal = ix("MW");
  if (iDate < 0 || iHr < 0 || iType < 0 || iVal < 0) {
    throw new SourceError("CAISO did not return the price table we checked (no OPR_DT, OPR_HR, LMP_TYPE, MW columns): the query may have no data, or the layout changed.");
  }
  const out: HourPrice[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    if (c[iType] !== "LMP") continue;
    const price = Number(c[iVal]);
    const hour = Number(c[iHr]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c[iDate] ?? "") || !Number.isInteger(hour) || !Number.isFinite(price) || c[iVal] === "") {
      throw new SourceError("CAISO changed the layout of the price rows (date, hour, price); this source needs updating.");
    }
    out.push({ date: c[iDate], hour, price });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  return out;
}

export function summariseSigned(values: number[]): PriceSummary | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return { count: clean.length, median: r2(percentile(clean, 0.5)), low: r2(percentile(clean, 0.1)), high: r2(percentile(clean, 0.9)), min: r2(clean[0]), max: r2(clean[clean.length - 1]) };
}

export type Getter = (url: string) => Promise<Buffer>;

export const defaultGet: Getter = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/zip,*/*", "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
};

export async function loadRange(hub: Hub, fromDate: string, toDate: string, get: Getter = defaultGet): Promise<HourPrice[]> {
  const zip = await get(queryUrl(hub, fromDate, toDate));
  return parseLmp(unzipFirst(zip).toString("utf8"));
}

/** Recent days up to tomorrow's day-ahead prices (published about 13:00 Pacific). One request. */
export async function loadRecent(hub: Hub, days: number, now: Date, get: Getter = defaultGet): Promise<HourPrice[]> {
  const today = Date.parse(isoDay(now.getTime()) + "T00:00:00Z");
  const rows = await loadRange(hub, isoDay(today - days * DAY), isoDay(today + 2 * DAY), get);
  return rows;
}

export function answerFromHours(hub: Hub, rows: HourPrice[], opts: { days: number; baseUrl?: string }): PriceAnswer {
  const s = summariseSigned(rows.map((r) => r.price));
  const first = rows[0];
  const last = rows[rows.length - 1];
  const lastDay = last?.date;
  const lastDayPrices = rows.filter((r) => r.date === lastDay).map((r) => r.price);
  const lastAvg = lastDayPrices.length ? r2(lastDayPrices.reduce((a, b) => a + b, 0) / lastDayPrices.length) : null;
  let cheapest: HourPrice | null = null;
  let dearest: HourPrice | null = null;
  for (const r of rows) {
    if (!cheapest || r.price < cheapest.price) cheapest = r;
    if (!dearest || r.price > dearest.price) dearest = r;
  }
  const neg = rows.filter((r) => r.price < 0).length;
  const hr = (r: HourPrice | null) => (r ? { date: r.date, hour_ending: r.hour, usd_per_mwh: r2(r.price) } : null);
  return buildAnswer({
    source: INFO,
    query: { country: "US", market: "day-ahead", hub, days: opts.days },
    summary: s,
    currency: "USD",
    unit: "per MWh",
    period: rows.length ? { from: first.date, to: last.date } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the hourly day-ahead locational marginal price (US dollars per MWh) at the CAISO ${hub} trading hub over the last ${opts.days} day(s) plus the next day when already published, ` +
      "from CAISO OASIS. Each delivery hour counts as one record. Wholesale market prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale day-ahead electricity in California (${HUB_LABEL[hub]}): median ${x.median} USD/MWh (${r2(x.median / 10)} cents/kWh), typical hours between ${x.low} and ${x.high} USD/MWh over ${new Set(rows.map((r) => r.date)).size} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          hub,
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_day: lastDay,
          latest_day_average_usd_per_mwh: lastAvg,
          cheapest_hour: hr(cheapest),
          dearest_hour: hr(dearest),
          negative_price_hours: neg,
          basis: "Wholesale day-ahead market price (CAISO, one trading hub, hourly); retail bills add delivery charges, taxes and margin. hour_ending 1 is the hour ending 01:00 Pacific standard time.",
        }
      : undefined,
  });
}

export async function caisoSpot(input: { hub?: string; days?: number; baseUrl?: string }, get: Getter = defaultGet, now: Date = new Date()): Promise<PriceAnswer> {
  const hub = parseHub(input.hub);
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const rows = await loadRecent(hub, days, now, get);
  if (rows.length === 0) throw new SourceError("CAISO returned no day-ahead prices for the period; the source may be updating.");
  return answerFromHours(hub, rows, { days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_ITEM = "day-ahead";

/** One library row from a day's hourly prices (needs 23 or more of 24 hours). */
export function dayRow(hub: Hub, rows: HourPrice[], date: string): DailyRow | null {
  const s = summariseSigned(rows.filter((r) => r.date === date).map((r) => r.price));
  if (!s || s.count < 23) return null;
  return { area: `US-${hub}`, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's delivery day at the three hubs (one request each, spaced out: OASIS limits request rate). */
export async function caisoHarvest(get: Getter = defaultGet, now: Date = new Date(), pauseMs = 6000): Promise<HarvestResult> {
  const date = isoDay(now.getTime() - DAY);
  const rows: DailyRow[] = [];
  let firstErr: unknown = null;
  for (const hub of HUBS) {
    if (rows.length || firstErr) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const hours = await loadRange(hub, date, isoDay(Date.parse(date + "T00:00:00Z") + 2 * DAY), get);
      const row = dayRow(hub, hours, date);
      if (row) rows.push(row);
    } catch (e) {
      firstErr = firstErr ?? e;
    }
  }
  if (rows.length === 0) throw firstErr ?? new SourceError(`CAISO: too few hours for ${date} at every hub.`);
  return {
    date,
    currency: "USD",
    unit: "per MWh",
    rows,
    note: "CAISO OASIS day-ahead market LMP, hourly, at the NP15, SP15 and ZP26 trading hubs, one delivery day. Source: California ISO.",
  };
}

export function caisoHistoryKey(hubRaw: string | undefined): { area: string; item: string; label: string } | null {
  let hub: Hub;
  try { hub = parseHub(hubRaw); } catch { return null; }
  return { area: `US-${hub}`, item: HISTORY_ITEM, label: `California ${hub} day-ahead wholesale power (CAISO, USD per MWh)` };
}
