// Spain and Portugal wholesale power: OMIE (OMI-Polo Español) marginal day-ahead price of the Iberian market, one plain text file per day.
// Format checked live on 2026-10-20 from GitHub's servers (probe omie-0), no key:
//   GET https://www.omie.es/en/file-download?parents=marginalpdbc&filename=marginalpdbc_YYYYMMDD.1  (CRLF text, ';' separated)
//   "MARGINALPDBC;"  then rows "year;month;day;period;price Portugal;price Spain;" (EUR/MWh), then a closing "*" line.
//   Since the market moved to 15-minute steps a normal day has 96 periods (92 / 100 on the clock-change days); older files have 24 (23 / 25).
//   Period 1 starts at local midnight (Europe/Madrid). The file for day D is published about 13:00 CET on D-1.
// OMIE legal notice (omie.es/en/legal-warning, read 2026-10-20): public, free information "can be used freely, provided that its original
// content is fully respected"; cite the source. No named open licence, so the answer carries that wording and says the statistics are ours.

import { SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const FILE_URL = "https://www.omie.es/en/file-download?parents=marginalpdbc&filename=marginalpdbc_";
export const LEGAL_URL = "https://www.omie.es/en/legal-warning";

export const COUNTRIES: Record<string, { name: string; column: "pt" | "es" }> = {
  ES: { name: "Spain", column: "es" },
  PT: { name: "Portugal", column: "pt" },
};

export const INFO: SourceInfo = {
  id: "es-omie",
  country: "ES, PT",
  category: "wholesale electricity (day-ahead)",
  name: "OMIE day-ahead power price",
  publisher: "OMIE (Iberian power exchange)",
  what_is_recorded:
    "The price at which the day-ahead auction cleared for one delivery period in Spain or Portugal, in euro per MWh (we average the 15-minute periods of each hour).",
  price_type: "transaction",
  freshness: "Prices are published the day before delivery (around 13:00 Central European Time); ProofPrice reads them on each request (cached up to 30 minutes)",
  licence: "OMIE legal notice: public, free information may be used freely if its original content is respected and the source is cited (no named open licence)",
  licence_url: LEGAL_URL,
  attribution:
    "Source: OMIE (OMI-Polo Español S.A.), marginal day-ahead price (file marginalpdbc), https://www.omie.es. Medians, ranges and counts are own calculations by ProofPrice from the published prices; OMIE is not responsible for them.",
  homepage: "https://www.omie.es",
  limits:
    "Wholesale exchange prices, not retail: a household or business bill adds grid access fees, taxes, charges and supplier margin. One price per period for the whole country (no region or town). " +
    "Day-ahead only. Prices can be negative. The record count is hours, not separate trades. OMIE gives no named open licence, only a legal notice: ProofPrice passes on the published prices unchanged and labels every statistic as its own calculation.",
};

export interface Point {
  ts: number; // ms since epoch, start of the hour (UTC)
  price: number; // EUR per MWh, mean of the periods inside the hour
}

export interface ParsedDay {
  date: string; // YYYY-MM-DD, the delivery day (Spain local)
  periods: { p: number; pt: number; es: number }[];
}

/** Parse one marginalpdbc file. Throws SourceError when the layout is not the one we checked. */
export function parseMarginal(text: string): ParsedDay {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!/^MARGINALPDBC/i.test(lines[0] ?? "")) throw new SourceError("OMIE has not published this price file (or changed its layout).");
  const periods: ParsedDay["periods"] = [];
  let date = "";
  for (const line of lines.slice(1)) {
    if (line.startsWith("*")) break;
    const f = line.split(";");
    const [y, m, d, p, pt, es] = f.map((v) => Number(v.replace(",", ".")));
    if (![y, m, d, p, pt, es].every(Number.isFinite) || f.length < 6) {
      throw new SourceError("OMIE changed the layout of its price file (expected year;month;day;period;PT;ES); this source needs updating.");
    }
    const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (date && day !== date) throw new SourceError("OMIE price file mixes several days; this source needs updating.");
    date = day;
    periods.push({ p, pt, es });
  }
  if (periods.length === 0) throw new SourceError("OMIE price file holds no prices yet.");
  return { date, periods };
}

const HOUR = 3600000;
const DAY = 86400000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoHour = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";

const madridFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
/** UTC milliseconds of local midnight (Europe/Madrid) at the start of the delivery day. */
export function madridMidnightUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  for (const off of [1, 2]) {
    const cand = Date.UTC(y, m - 1, d) - off * HOUR;
    const parts = Object.fromEntries(madridFmt.formatToParts(new Date(cand)).map((x) => [x.type, x.value]));
    if (Number(parts.hour) === 0 && Number(parts.day) === d) return cand;
  }
  throw new SourceError(`Cannot place ${date} on the Madrid clock.`);
}

/** Hourly mean prices for one country: 4 periods per hour on 15-minute days, 1 per hour on hourly days. */
export function hourlyPoints(day: ParsedDay, country: string): Point[] {
  const c = COUNTRIES[country.toUpperCase()];
  if (!c) throw new SourceError(`OMIE wholesale power: country ${country} is not available (${Object.keys(COUNTRIES).join(", ")}).`);
  const n = day.periods.length;
  const perHour = n >= 90 ? 4 : n >= 22 ? 1 : 0;
  if (!perHour) throw new SourceError(`OMIE price file has ${n} periods (expected 92-100 or 23-25); this source needs updating.`);
  const start = madridMidnightUtc(day.date);
  const by = new Map<number, number[]>();
  for (const x of day.periods) {
    const idx = Math.floor((x.p - 1) / perHour);
    const v = x[c.column];
    if (!Number.isFinite(v)) continue;
    const a = by.get(idx);
    if (a) a.push(v);
    else by.set(idx, [v]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([idx, v]) => ({ ts: start + idx * HOUR, price: v.reduce((s, t) => s + t, 0) / v.length }));
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
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
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

const compact = (date: string) => date.replace(/-/g, "");
export const fileUrl = (date: string) => `${FILE_URL}${compact(date)}.1`;

/** One day's parsed file, or null when OMIE has not published it (404 or a page that is not a price file). Outages still throw. */
export async function loadDay(date: string, get: Getter = defaultGet): Promise<ParsedDay | null> {
  let text: string;
  try {
    text = await get(fileUrl(date));
  } catch (e: any) {
    if (e?.status === 404 || /HTTP 404/.test(String(e?.message))) return null;
    throw e;
  }
  if (!/^\s*MARGINALPDBC/i.test(text)) return null;
  return parseMarginal(text);
}

/** Hourly points of the last `days` days up to `now` (only hours that have started). */
export async function loadPoints(country: string, days: number, now: Date, get: Getter = defaultGet): Promise<Point[]> {
  const today = Date.parse(isoDay(now.getTime()) + "T00:00:00Z");
  const dates: string[] = [];
  for (let i = days; i >= -1; i--) dates.push(isoDay(today - i * DAY)); // +1: the Madrid day starts at 22:00 or 23:00 UTC the evening before
  const out: Point[] = [];
  let outage: unknown = null;
  for (let i = 0; i < dates.length; i += 5) {
    const chunk = await Promise.all(dates.slice(i, i + 5).map((d) => loadDay(d, get).catch((e) => { outage = e; return null; })));
    for (const day of chunk) if (day) out.push(...hourlyPoints(day, country));
  }
  const from = now.getTime() - days * DAY;
  const pts = out.filter((p) => p.ts >= from && p.ts < now.getTime()).sort((a, b) => a.ts - b.ts);
  if (pts.length === 0 && outage) throw outage;
  return pts;
}

export function answerFromPoints(pts: Point[], opts: { country: string; countryName: string; days: number; baseUrl?: string }): PriceAnswer {
  const s = summariseSigned(pts.map((p) => p.price));
  const last = pts[pts.length - 1];
  const negHours = pts.filter((p) => p.price < 0).length;
  const lastDay = last ? pts.filter((p) => p.ts >= last.ts - 23 * HOUR) : [];
  const dayAvg = lastDay.length >= 5 ? r2(lastDay.reduce((a, p) => a + p.price, 0) / lastDay.length) : null;
  const cheapest = pts.length ? pts.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const dearest = pts.length ? pts.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: opts.country, market: "day-ahead", days: opts.days },
    summary: s,
    currency: "EUR",
    unit: "per MWh",
    period: pts.length ? { from: isoDay(pts[0].ts), to: isoDay(last.ts) } : { from: null, to: null },
    method:
      `Median and 10th-90th percentile of the hourly average day-ahead auction price (euro per MWh) for ${opts.countryName} over the last ${opts.days} day(s), ` +
      "from the OMIE marginal price files (15-minute periods averaged per hour). Each hour counts as one record. Wholesale exchange prices, not retail bills. Negative prices are kept.",
    describe: (x) =>
      `Wholesale day-ahead electricity in ${opts.countryName}: median ${x.median} EUR/MWh (${r2(x.median / 10)} cents/kWh), typical hours between ${x.low} and ${x.high} EUR/MWh over the last ${opts.days} day(s). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          cents_per_kwh: { median: r2(s.median / 10), typical_low: r2(s.low / 10), typical_high: r2(s.high / 10) },
          latest_hour: last ? { time_utc: isoHour(last.ts), eur_per_mwh: r2(last.price) } : null,
          latest_24h_average_eur_per_mwh: dayAvg,
          cheapest_hour: cheapest ? { time_utc: isoHour(cheapest.ts), eur_per_mwh: r2(cheapest.price) } : null,
          dearest_hour: dearest ? { time_utc: isoHour(dearest.ts), eur_per_mwh: r2(dearest.price) } : null,
          negative_price_hours: negHours,
          bidding_zone: opts.country,
          basis: "Wholesale day-ahead exchange price (hourly average); household bills add grid fees, taxes and margin.",
        }
      : undefined,
  });
}

export async function omieDayAhead(
  input: { country: string; days?: number; baseUrl?: string },
  get: Getter = defaultGet,
  now: Date = new Date(),
): Promise<PriceAnswer> {
  const cc = input.country.toUpperCase();
  const c = COUNTRIES[cc];
  if (!c) throw new SourceError(`OMIE wholesale power: country ${input.country} is not available (${Object.keys(COUNTRIES).join(", ")}).`);
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const pts = await loadPoints(cc, days, now, get);
  if (pts.length === 0) throw new SourceError("OMIE returned no published prices for the period; the source may be updating.");
  return answerFromPoints(pts, { country: cc, countryName: c.name, days, baseUrl: input.baseUrl });
}

// ---------- daily collector ----------

export const HISTORY_ITEM = "day-ahead";

/** One library row from a day's hourly prices (needs 20+ of 24 hours). */
export function dayRow(area: string, pts: Point[]): DailyRow | null {
  const s = summariseSigned(pts.map((p) => p.price));
  if (!s || s.count < 20) return null;
  return { area, item: HISTORY_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max };
}

/** Yesterday's (UTC date) delivery day: one file gives both countries. */
export async function omieHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const date = isoDay(now.getTime() - DAY);
  const day = await loadDay(date, get);
  if (!day) throw new SourceError(`OMIE has not published the price file for ${date}.`);
  const rows: DailyRow[] = [];
  const problems: string[] = [];
  for (const cc of Object.keys(COUNTRIES)) {
    const row = dayRow(cc, hourlyPoints(day, cc));
    if (row) rows.push(row);
    else problems.push(`${cc}: too few hours`);
  }
  if (rows.length === 0) throw new SourceError(`OMIE: no country had a full day for ${date} (${problems.join("; ")}).`);
  return {
    date,
    currency: "EUR",
    unit: "per MWh",
    rows,
    note: "OMIE marginal day-ahead price (marginalpdbc), hourly mean of the periods of one Madrid delivery day, Spain and Portugal. Source: OMIE." + (problems.length ? ` Skipped: ${problems.join("; ")}.` : ""),
  };
}

export function omieHistoryKey(country: string): { area: string; item: string; label: string } | null {
  const c = COUNTRIES[country.toUpperCase()];
  if (!c) return null;
  return { area: country.toUpperCase(), item: HISTORY_ITEM, label: `${c.name} day-ahead wholesale power (OMIE)` };
}
