// Europe wholesale power: Energy-Charts API (Fraunhofer ISE) day-ahead price per bidding zone.
// Format checked live on 2026-10-17 from GitHub's servers (probe):
//   GET https://api.energy-charts.info/price?bzn=FR&start=2026-10-16&end=2026-10-17  (no key)
//   -> {"license_info":"CC BY 4.0 (...) from Bundesnetzagentur | SMARD.de","unix_seconds":[s, ...15-min steps, start of period],"price":[EUR/MWh,...],"unit":"EUR / MWh","deprecated":false}
// The licence differs by zone: FR, NL, AT, BE, PL, DK1, DK2, IT-North, NO2 say CC BY 4.0; ES, PT, SE1-4, NO1, IT-Sicily say "private and internal use only".
// So we serve only the CC BY zones and refuse any answer whose license_info is not CC BY (the licence is checked on every response).
// Germany is served by de-smard (same wholesale-power category), so DE is not listed here.

import { SourceError, fetchJson, retryOnce } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const API = "https://api.energy-charts.info/price";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

export interface Zone {
  code: string; // Energy-Charts bzn value
  label: string;
}
export interface CountryZones {
  name: string;
  defaultZone: string;
  zones: Record<string, string>; // zone code -> human label
}

/** Only zones whose live response said CC BY 4.0 on 2026-10-17. */
export const COUNTRIES: Record<string, CountryZones> = {
  AT: { name: "Austria", defaultZone: "AT", zones: { AT: "Austria" } },
  BE: { name: "Belgium", defaultZone: "BE", zones: { BE: "Belgium" } },
  DK: { name: "Denmark", defaultZone: "DK1", zones: { DK1: "West Denmark (DK1)", DK2: "East Denmark (DK2)" } },
  FR: { name: "France", defaultZone: "FR", zones: { FR: "France" } },
  IT: { name: "Italy", defaultZone: "IT-North", zones: { "IT-North": "Northern Italy" } },
  NL: { name: "the Netherlands", defaultZone: "NL", zones: { NL: "the Netherlands" } },
  NO: { name: "Norway", defaultZone: "NO2", zones: { NO2: "South-west Norway (NO2)" } },
  PL: { name: "Poland", defaultZone: "PL", zones: { PL: "Poland" } },
};

export const INFO: SourceInfo = {
  id: "eu-energy-charts",
  country: "AT, BE, DK, FR, IT (north), NL, NO (south-west), PL",
  category: "wholesale electricity (day-ahead)",
  name: "Energy-Charts: day-ahead wholesale electricity price by bidding zone",
  publisher: "Fraunhofer ISE (Energy-Charts), with data from Bundesnetzagentur | SMARD.de",
  what_is_recorded:
    "The day-ahead auction price of electricity in one bidding zone, in euro per MWh: the price at which the power exchange cleared the next-day contracts (we average each hour).",
  price_type: "transaction",
  freshness: "Prices are published the day before delivery (around 13:00 Central European Time); ProofPrice reads them on each request (cached up to 30 minutes)",
  licence: "CC BY 4.0 (stated in every Energy-Charts response for these zones: from Bundesnetzagentur | SMARD.de)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: Energy-Charts (Fraunhofer ISE), data from Bundesnetzagentur | SMARD.de. Licensed under CC BY 4.0. Medians, ranges and counts are own calculations by ProofPrice from the hourly average of the day-ahead prices.",
  homepage: "https://www.energy-charts.info",
  limits:
    "Wholesale exchange prices, not retail: a household or business bill adds grid fees, taxes, levies and supplier margin. One price per hour for a whole bidding zone (no region or town). " +
    "Only zones that Energy-Charts publishes under CC BY 4.0 are included, so Spain, Portugal and Sweden are not available. Prices can be negative. Day-ahead only. The record count is hours, not separate trades.",
};

export interface Point {
  ts: number; // ms since epoch, start of the hour
  price: number; // EUR per MWh (mean of the period prices inside the hour)
}

/** Throws unless the response carries a CC BY licence. Returns nothing. */
export function checkLicence(json: any, zone: string): void {
  const l = json?.license_info;
  if (typeof l !== "string" || !/^CC BY 4\.0/i.test(l.trim())) {
    throw new SourceError(
      `Energy-Charts no longer publishes the ${zone} zone under CC BY 4.0 (license_info changed), so ProofPrice does not serve it until the licence is checked again.`,
    );
  }
}

/** Hourly mean prices from one response (the 15-minute or hourly steps are averaged per hour). Drops null prices. */
export function parseHourly(json: any): Point[] {
  const t = json?.unix_seconds;
  const p = json?.price;
  if (!Array.isArray(t) || !Array.isArray(p) || t.length !== p.length) {
    throw new SourceError('Energy-Charts changed the layout of its price answer (expected {"unix_seconds":[...],"price":[...]}); this source needs updating.');
  }
  const by = new Map<number, number[]>();
  for (let i = 0; i < t.length; i++) {
    if (typeof t[i] !== "number" || typeof p[i] !== "number" || !Number.isFinite(p[i])) continue;
    const h = Math.floor(t[i] / 3600) * 3600000;
    const a = by.get(h);
    if (a) a.push(p[i]);
    else by.set(h, [p[i]]);
  }
  return [...by.entries()].map(([ts, v]) => ({ ts, price: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => a.ts - b.ts);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

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

export const priceUrl = (zone: string, fromMs: number, toMs: number) =>
  `${API}?bzn=${encodeURIComponent(zone)}&start=${isoDay(fromMs)}&end=${isoDay(toMs)}`;

/** Resolve country (+ optional zone) to a zone code, or throw a SourceError that lists what is available. */
export function resolveZone(country: string, zone?: string): { code: string; label: string; countryName: string } {
  const c = COUNTRIES[country.toUpperCase()];
  if (!c) throw new SourceError(`Energy-Charts wholesale power: country ${country} is not available (${Object.keys(COUNTRIES).join(", ")}).`);
  const z = zone ? Object.keys(c.zones).find((k) => k.toLowerCase() === zone.toLowerCase()) : c.defaultZone;
  if (!z) throw new SourceError(`Zone ${zone} is not available for ${c.name}; choose ${Object.keys(c.zones).join(" or ")}.`);
  return { code: z, label: c.zones[z], countryName: c.name };
}

export async function loadPoints(zone: string, fromMs: number, toMs: number, get: Getter = defaultGet): Promise<Point[]> {
  const json = await get(priceUrl(zone, fromMs, toMs));
  checkLicence(json, zone);
  return parseHourly(json).filter((p) => p.ts >= fromMs && p.ts < toMs);
}

export function answerFromPoints(pts: Point[], opts: { country: string; zone: string; zoneLabel: string; countryName: string; days: number; baseUrl?: string }): PriceAnswer {
  const s = summariseSigned(pts.map((p) => p.price));
  const last = pts[pts.length - 1];
  const negHours = pts.filter((p) => p.price < 0).length;
  const lastDay = last ? pts.filter((p) => p.ts >= last.ts - 23 * HOUR) : [];
  const dayAvg = lastDay.length >= 5 ? r2(lastDay.reduce((a, p) => a + p.price, 0) / lastDay.length) : null;
  const cheapest = pts.length ? pts.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const dearest = pts.length ? pts.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: opts.country, zone: opts.zone, market: "day-ahead", days: opts.days },
    summary: s,
    currency: "EUR",
    unit: "per MWh",
    period: pts.length ? { from: isoDay(pts[0].ts), to: isoDay(last.ts) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the hourly average day-ahead auction price (euro per MWh) for ${opts.zoneLabel} over the last ${opts.days} day(s), ` +
      "from Energy-Charts (Fraunhofer ISE). Each hour counts as one record. Wholesale exchange prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale day-ahead electricity in ${opts.zoneLabel}: median ${x.median} EUR/MWh (${r2(x.median / 10)} cents/kWh), typical hours between ${x.low} and ${x.high} EUR/MWh over the last ${opts.days} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_hour: last ? { time_utc: isoHour(last.ts), eur_per_mwh: r2(last.price) } : null,
          latest_24h_average_eur_per_mwh: dayAvg,
          cheapest_hour: cheapest ? { time_utc: isoHour(cheapest.ts), eur_per_mwh: r2(cheapest.price) } : null,
          dearest_hour: dearest ? { time_utc: isoHour(dearest.ts), eur_per_mwh: r2(dearest.price) } : null,
          negative_price_hours: negHours,
          bidding_zone: opts.zone,
          basis: "Wholesale day-ahead exchange price (hourly average); household bills add grid fees, taxes and margin.",
        }
      : undefined,
  });
}

export async function energyChartsDayAhead(
  input: { country: string; zone?: string; days?: number; baseUrl?: string },
  get: Getter = defaultGet,
  now: Date = new Date(),
): Promise<PriceAnswer> {
  const z = resolveZone(input.country, input.zone);
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const to = now.getTime();
  const pts = await loadPoints(z.code, to - days * DAY, to, get);
  if (pts.length === 0) throw new SourceError("Energy-Charts returned no published prices for the period; the source may be updating.");
  return answerFromPoints(pts, { country: input.country.toUpperCase(), zone: z.code, zoneLabel: z.label, countryName: z.countryName, days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_ITEM = "day-ahead";

/** One library row from a day's hourly prices (needs 20+ of 24 hours). */
export function dayRow(area: string, pts: Point[]): DailyRow | null {
  const s = summariseSigned(pts.map((p) => p.price));
  if (!s || s.count < 20) return null;
  return { area, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's (UTC) hourly prices for each country's default zone: one aggregate row per country. A country that fails is skipped; all failing is an error. */
export async function energyChartsHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const dayStart = Date.parse(isoDay(now.getTime() - DAY) + "T00:00:00Z");
  const rows: DailyRow[] = [];
  const problems: string[] = [];
  for (const [cc, c] of Object.entries(COUNTRIES)) {
    try {
      const pts = await loadPoints(c.defaultZone, dayStart, dayStart + DAY, get);
      const row = dayRow(cc, pts);
      if (row) rows.push(row);
      else problems.push(`${cc}: ${pts.length} hours`);
    } catch (e: any) {
      problems.push(`${cc}: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }
  if (rows.length === 0) throw new SourceError(`Energy-Charts: no country had a full day for ${isoDay(dayStart)} (${problems.join("; ")}).`);
  return {
    date: isoDay(dayStart),
    currency: "EUR",
    unit: "per MWh",
    rows,
    note:
      "Energy-Charts day-ahead prices (hourly mean), one UTC day, default bidding zone per country (DK1, IT-North, NO2). Fraunhofer ISE with data from Bundesnetzagentur | SMARD.de, CC BY 4.0." +
      (problems.length ? ` Skipped: ${problems.join("; ")}.` : ""),
  };
}

export function energyChartsHistoryKey(country: string): { area: string; item: string; label: string } | null {
  const c = COUNTRIES[country.toUpperCase()];
  if (!c) return null;
  return { area: country.toUpperCase(), item: HISTORY_ITEM, label: `${c.name} day-ahead wholesale power (${c.defaultZone})` };
}
