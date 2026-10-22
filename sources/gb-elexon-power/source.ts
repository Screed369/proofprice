// Great Britain wholesale power: Elexon BMRS (Insights API) Market Index Data, half-hourly traded price of the day-ahead/intraday spot market.
// Format checked live on 2026-10-22 from GitHub's servers (probe elexon-mi1), no key:
//   GET https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=2026-10-21T00:00Z&to=2026-10-21T23:59Z&format=json
//   {"metadata":{"datasets":["MID"]},"data":[{"startTime":"2026-10-21T23:30:00Z","dataProvider":"APXMIDP","settlementDate":"2026-10-22",
//   "settlementPeriod":2,"price":103.78,"volume":2420.950}, {... "dataProvider":"N2EXMIDP" ... "price":0.00,"volume":0.000}, ...]}
//   Two providers per half-hour; N2EXMIDP is all zero (price 0, volume 0) and is dropped, only rows with volume > 0 count. Price GBP per MWh. Times UTC.
// Elexon BMRS licence (read 2026-10-22 by the Verifier): free to use the data "including commercially, or by including it in your own product or application"; attribution required.

import { SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const API = "https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index";
export const LICENCE_URL = "https://www.elexon.co.uk/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/";

export const INFO: SourceInfo = {
  id: "gb-elexon-power",
  country: "GB",
  category: "wholesale electricity (spot market index)",
  name: "Elexon BMRS market index price",
  publisher: "Elexon (Balancing Mechanism Reporting Service)",
  what_is_recorded:
    "The volume-weighted price of electricity traded on the Great Britain spot power exchange (APX) for one half-hour, in pounds per MWh. Half-hours with no traded volume are left out.",
  price_type: "transaction",
  freshness: "Half-hourly prices appear within hours of each trading period and are read on each request (cached up to 30 minutes)",
  licence: "Elexon BMRS data licence: free to use, including commercially, with attribution; no official status implied",
  licence_url: LICENCE_URL,
  attribution:
    "Contains BMRS data © Elexon Limited copyright and database right 2026. Source: Elexon BMRS Market Index Data, https://bmrs.elexon.co.uk. Medians, ranges and counts are own calculations by ProofPrice; Elexon does not endorse them.",
  homepage: "https://bmrs.elexon.co.uk",
  limits:
    "Wholesale exchange prices in pounds per MWh (not euro), not retail: a household or business bill adds network charges, taxes, levies and supplier margin. One price for Great Britain (England, Scotland and Wales), not Northern Ireland. " +
    "Only the APX provider reports volume; the record count is half-hours, not separate trades. Prices can be negative.",
};

export interface Point {
  ts: number; // ms since epoch, start of the half-hour (UTC)
  price: number; // GBP per MWh
  volume: number; // MWh traded
}

const HALF = 1800000;
const DAY = 86400000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoSlot = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";

/** Parse one Market Index response. Keeps rows with traded volume only. Throws SourceError when the layout is not the one we checked. */
export function parseMarketIndex(text: string): Point[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceError("Elexon returned something that is not JSON; this source may need updating.");
  }
  if (!json || !Array.isArray(json.data)) throw new SourceError("Elexon changed the layout of the market index response (no data list); this source needs updating.");
  const out: Point[] = [];
  for (const r of json.data) {
    const ts = Date.parse(String(r?.startTime));
    const price = Number(r?.price);
    const volume = Number(r?.volume);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || !Number.isFinite(volume)) {
      throw new SourceError("Elexon changed the layout of the market index rows (startTime, price, volume); this source needs updating.");
    }
    if (volume > 0) out.push({ ts, price, volume });
  }
  // One price per half-hour: if several providers report volume, take the volume-weighted mean.
  const by = new Map<number, { v: number; pv: number }>();
  for (const p of out) {
    const a = by.get(p.ts) ?? { v: 0, pv: 0 };
    a.v += p.volume;
    a.pv += p.price * p.volume;
    by.set(p.ts, a);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([ts, a]) => ({ ts, price: a.pv / a.v, volume: a.v }));
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

const defaultGet: Getter = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
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

export const dayUrl = (date: string) => `${API}?from=${date}T00:00Z&to=${date}T23:59Z&format=json`;

/** The half-hourly prices that started on one UTC date. */
export async function loadDay(date: string, get: Getter = defaultGet): Promise<Point[]> {
  return parseMarketIndex(await get(dayUrl(date)));
}

/** Points of the last `days` days up to `now` (only half-hours that have started). */
export async function loadPoints(days: number, now: Date, get: Getter = defaultGet): Promise<Point[]> {
  const today = Date.parse(isoDay(now.getTime()) + "T00:00:00Z");
  const dates: string[] = [];
  for (let i = days; i >= 0; i--) dates.push(isoDay(today - i * DAY));
  const out: Point[] = [];
  let outage: unknown = null;
  for (let i = 0; i < dates.length; i += 5) {
    const chunk = await Promise.all(dates.slice(i, i + 5).map((d) => loadDay(d, get).catch((e) => { outage = e; return [] as Point[]; })));
    for (const pts of chunk) out.push(...pts);
  }
  const from = now.getTime() - days * DAY;
  const pts = out.filter((p) => p.ts >= from && p.ts < now.getTime()).sort((a, b) => a.ts - b.ts);
  if (pts.length === 0 && outage) throw outage;
  return pts;
}

export function answerFromPoints(pts: Point[], opts: { days: number; baseUrl?: string }): PriceAnswer {
  const s = summariseSigned(pts.map((p) => p.price));
  const last = pts[pts.length - 1];
  const negSlots = pts.filter((p) => p.price < 0).length;
  const lastDay = last ? pts.filter((p) => p.ts > last.ts - DAY) : [];
  const dayAvg = lastDay.length >= 20 ? r2(lastDay.reduce((a, p) => a + p.price, 0) / lastDay.length) : null;
  const cheapest = pts.length ? pts.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const dearest = pts.length ? pts.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: "GB", market: "spot", days: opts.days },
    summary: s,
    currency: "GBP",
    unit: "per MWh",
    period: pts.length ? { from: isoDay(pts[0].ts), to: isoDay(last.ts) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the half-hourly traded spot price (pounds per MWh, not euro) for Great Britain over the last ${opts.days} day(s), ` +
      "from the Elexon BMRS Market Index (APX exchange; half-hours with no traded volume are left out). Each half-hour counts as one record. Wholesale exchange prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale spot electricity in Great Britain: median ${x.median} GBP/MWh (${r2(x.median / 10)} pence/kWh), typical half-hours between ${x.low} and ${x.high} GBP/MWh over the last ${opts.days} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          pence_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_half_hour: last ? { time_utc: isoSlot(last.ts), gbp_per_mwh: r2(last.price) } : null,
          latest_24h_average_gbp_per_mwh: dayAvg,
          cheapest_half_hour: cheapest ? { time_utc: isoSlot(cheapest.ts), gbp_per_mwh: r2(cheapest.price) } : null,
          dearest_half_hour: dearest ? { time_utc: isoSlot(dearest.ts), gbp_per_mwh: r2(dearest.price) } : null,
          negative_price_half_hours: negSlots,
          currency_note: "Pounds sterling per MWh (this source is not in euro).",
          basis: "Wholesale spot exchange price (APX market index, half-hourly); household bills add network charges, levies, taxes and margin.",
        }
      : undefined,
  });
}

export async function elexonSpot(input: { days?: number; baseUrl?: string }, get: Getter = defaultGet, now: Date = new Date()): Promise<PriceAnswer> {
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const pts = await loadPoints(days, now, get);
  if (pts.length === 0) throw new SourceError("Elexon returned no traded prices for the period; the source may be updating.");
  return answerFromPoints(pts, { days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_ITEM = "spot";

/** One library row from a day's half-hourly prices (needs 40+ of 48 half-hours). */
export function dayRow(area: string, pts: Point[]): DailyRow | null {
  const s = summariseSigned(pts.map((p) => p.price));
  if (!s || s.count < 40) return null;
  return { area, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's (UTC date) half-hours. */
export async function elexonHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const date = isoDay(now.getTime() - DAY);
  const pts = (await loadDay(date, get)).filter((p) => isoDay(p.ts) === date);
  const row = dayRow("GB", pts);
  if (!row) throw new SourceError(`Elexon: too few traded half-hours for ${date} (${pts.length}).`);
  return {
    date,
    currency: "GBP",
    unit: "per MWh",
    rows: [row],
    note: "Elexon BMRS Market Index (APX), half-hourly traded price of one UTC day, Great Britain. Contains BMRS data © Elexon Limited.",
  };
}

export function elexonHistoryKey(country: string): { area: string; item: string; label: string } | null {
  if (country.toUpperCase() !== "GB") return null;
  return { area: "GB", item: HISTORY_ITEM, label: "Great Britain spot wholesale power (Elexon, GBP per MWh)" };
}
