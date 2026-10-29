// Japan wholesale power: JEPX (Japan Electric Power Exchange) day-ahead spot market, one CSV per fiscal year, half-hourly.
// Format checked live on 2026-10-21 from GitHub's servers (probe vjepx2), no key, Shift-JIS (we only read the ASCII digits):
//   GET https://www.jepx.jp/market/excel/spot_2026.csv  (fiscal year starting 2026/04/01, rewritten daily, ~2.5 MB and growing)
//   header row (Japanese), then rows "YYYY/MM/DD,slot 1-48,sell bids kWh,buy bids kWh,contracted kWh,system price,Hokkaido,Tohoku,Tokyo,Chubu,
//   Hokuriku,Kansai,Chugoku,Shikoku,Kyushu,(blank),..." prices in yen per kWh. Slot 1 starts at 00:00 Japan time.
// The big file is read only by the daily collector (harvest); requests are answered from the price library.
// JEPX disclaimer (jepx.jp/disclaimer, read 2026-10-24): copyright belongs to JEPX; "when you use it, state the source". No named open licence,
// so the licence is NOT cleared for paid use: this source is free tier only (Simon, 29 Oct 2026) and every statistic is labelled as ours.

import { SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { percentile, PriceSummary } from "../../lib/stats";
import { readDaily, readLatestDay } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const SPOT_URL = (year: number) => `https://www.jepx.jp/market/excel/spot_${year}.csv`;
export const DISCLAIMER_URL = "https://www.jepx.jp/disclaimer/";
export const HISTORY_ITEM = "day-ahead";
/** Library area key of the nationwide system price. */
export const SYSTEM_AREA = "JP";

/** CSV column index (0-based) of each price series. */
export const SERIES: { area: string; name: string; col: number }[] = [
  { area: "JP", name: "System (nationwide) price", col: 5 },
  { area: "JP-HOKKAIDO", name: "Hokkaido", col: 6 },
  { area: "JP-TOHOKU", name: "Tohoku", col: 7 },
  { area: "JP-TOKYO", name: "Tokyo", col: 8 },
  { area: "JP-CHUBU", name: "Chubu", col: 9 },
  { area: "JP-HOKURIKU", name: "Hokuriku", col: 10 },
  { area: "JP-KANSAI", name: "Kansai", col: 11 },
  { area: "JP-CHUGOKU", name: "Chugoku", col: 12 },
  { area: "JP-SHIKOKU", name: "Shikoku", col: 13 },
  { area: "JP-KYUSHU", name: "Kyushu", col: 14 },
];

export const INFO: SourceInfo = {
  id: "jp-jepx-spot",
  country: "JP (Japan)",
  category: "wholesale electricity (day-ahead)",
  name: "JEPX day-ahead spot market price",
  publisher: "Japan Electric Power Exchange (JEPX)",
  what_is_recorded:
    "The price at which the day-ahead spot market cleared for each half-hour of a delivery day, in yen per kWh: the nationwide system price and the nine area prices (Hokkaido, Tohoku, Tokyo, Chubu, Hokuriku, Kansai, Chugoku, Shikoku, Kyushu).",
  price_type: "transaction",
  freshness: "JEPX rewrites its file every day; ProofPrice copies it once a day and answers with the newest complete delivery day it holds (usually yesterday, Japan time)",
  licence:
    "JEPX 'Disclaimer and copyright' page: copyright in the site content belongs to JEPX and 'when you use it, state the source' (当ウェブサイトに掲載されている内容に関する著作権は本所にあります。利用する場合は、出所を明示した上でご利用下さい。). No named open licence and no commercial wording, so this source is served free of charge only.",
  licence_url: DISCLAIMER_URL,
  attribution:
    "出所：一般社団法人日本卸電力取引所（JEPX） / Source: Japan Electric Power Exchange (JEPX), day-ahead spot market results, https://www.jepx.jp. Medians, ranges and counts are own calculations by ProofPrice from the published prices; JEPX is not responsible for them.",
  homepage: "https://www.jepx.jp",
  limits:
    "Wholesale exchange prices in yen per kWh, not retail: a household or business bill adds grid fees, levies, taxes and supplier margin. Day-ahead spot only (not intraday or futures). " +
    "The record count is half-hours (48 a day), not separate trades. Prices are copied from JEPX's file once a day; JEPX may change or withdraw published data without notice and gives no accuracy guarantee.",
};

export interface JepxDay {
  date: string; // YYYY-MM-DD, delivery day (Japan)
  slots: number; // distinct half-hour slots seen
  /** price per half-hour, by library area key, indexed by slot-1 (NaN when missing) */
  prices: Record<string, number[]>;
}

/** Parse the CSV text (any single-byte decoding) into one entry per delivery day. Throws SourceError when the layout is not the one we checked. */
export function parseSpotCsv(text: string): JepxDay[] {
  const days = new Map<string, JepxDay>();
  let dataRows = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^\d{4}\/\d{2}\/\d{2},/.test(line)) continue; // header and blank lines
    const f = line.split(",");
    const slot = Number(f[1]);
    if (!Number.isInteger(slot) || slot < 1 || slot > 50 || f.length < 15) {
      throw new SourceError("JEPX changed the layout of its spot price file (expected date,slot,volumes,system price,9 area prices); this source needs updating.");
    }
    const date = f[0].replace(/\//g, "-");
    let d = days.get(date);
    if (!d) {
      d = { date, slots: 0, prices: Object.fromEntries(SERIES.map((s) => [s.area, new Array(48).fill(NaN)])) };
      days.set(date, d);
    }
    if (slot <= 48) {
      d.slots++;
      for (const s of SERIES) {
        const v = Number(f[s.col]);
        d.prices[s.area][slot - 1] = Number.isFinite(v) && f[s.col].trim() !== "" ? v : NaN;
      }
    }
    dataRows++;
  }
  if (dataRows === 0) throw new SourceError("JEPX spot file holds no price rows (or changed its layout); this source needs updating.");
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
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

/** One library row per series for a complete day (at least 44 of 48 half-hours; 46/50 slots only on clock changes, which Japan does not have). */
export function dayRows(day: JepxDay): DailyRow[] {
  if (day.slots < 44) return [];
  const rows: DailyRow[] = [];
  for (const s of SERIES) {
    const sum = summariseSigned(day.prices[s.area]);
    if (sum && sum.count >= 44) rows.push({ area: s.area, item: HISTORY_ITEM, n: sum.count, median: sum.median, low: sum.low, high: sum.high, min: sum.min, max: sum.max });
  }
  return rows;
}

// ---------- fetch (collector only) ----------

export type Getter = (url: string) => Promise<string>;

const defaultGet: Getter = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return Buffer.from(await res.arrayBuffer()).toString("latin1"); // Shift-JIS: we only read ASCII digits
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
};

const DAY = 86400000;
const jstDate = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

/** The file that should hold a date: JEPX names it by the fiscal year that starts in April (spot_2026.csv starts 2026/04/01). */
export function fileYears(date: string): number[] {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  return fy === y ? [y] : [fy, y]; // Jan-Mar: the fiscal-year file first, the calendar-year file as a fallback
}

/** Yesterday's (Japan) delivery day as library rows. */
export async function jepxHarvest(get: Getter = defaultGet, now: Date = new Date()): Promise<HarvestResult> {
  const date = jstDate(now.getTime() - DAY);
  let found: JepxDay | undefined;
  let lastErr: unknown = null;
  for (const year of fileYears(date)) {
    try {
      found = parseSpotCsv(await get(SPOT_URL(year))).find((d) => d.date === date);
      if (found) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!found) {
    if (lastErr) throw lastErr;
    throw new SourceError(`JEPX has not published the spot prices for ${date} yet.`);
  }
  const rows = dayRows(found);
  if (rows.length === 0) throw new SourceError(`JEPX spot prices for ${date} are incomplete (${found.slots} of 48 half-hours).`);
  return {
    date,
    currency: "JPY",
    unit: "per kWh",
    rows,
    note: "JEPX day-ahead spot market clearing prices, half-hourly, one Japan delivery day: nationwide system price (area JP) and nine area prices (JP-TOKYO ...). Source: JEPX.",
  };
}

export function jepxHistoryKey(country: string): { area: string; item: string; label: string } | null {
  if (country.toUpperCase() !== "JP") return null;
  return { area: SYSTEM_AREA, item: HISTORY_ITEM, label: "Japan day-ahead wholesale power, system price (JEPX)" };
}

// ---------- answers (from the library) ----------

export interface LibraryReader {
  range(from: string, to: string): LibraryRow[]; // system-price rows, oldest first
  latest(): { date: string; rows: LibraryRow[] } | null; // every row of the newest day
}

export const libraryReader: LibraryReader = {
  range: (from, to) => readDaily(INFO.id, { area: SYSTEM_AREA, item: HISTORY_ITEM, from, to }),
  latest: () => readLatestDay(INFO.id),
};

export function answerFromRows(
  latest: { date: string; rows: LibraryRow[] },
  recent: LibraryRow[],
  opts: { days: number; baseUrl?: string },
): PriceAnswer {
  const sys = latest.rows.find((r) => r.area === SYSTEM_AREA);
  const s: PriceSummary | null = sys ? { count: sys.n, median: sys.median, low: sys.low, high: sys.high, min: sys.min, max: sys.max } : null;
  const areaMedians = SERIES.filter((x) => x.area !== SYSTEM_AREA).flatMap((x) => {
    const r = latest.rows.find((y) => y.area === x.area);
    return r ? [{ area: x.name, median_jpy_per_kwh: r.median, low: r.low, high: r.high }] : [];
  });
  const daily = recent.map((r) => ({ date: r.date, median_jpy_per_kwh: r.median, low: r.low, high: r.high, min: r.min, max: r.max }));
  return buildAnswer({
    source: INFO,
    query: { country: "JP", market: "day-ahead", lookback_days: opts.days },
    summary: s,
    currency: "JPY",
    unit: "per kWh",
    period: { from: latest.date, to: latest.date },
    method:
      "Japan wholesale power: the median and 10th-90th percentile of the 48 half-hourly day-ahead spot market prices (nationwide system price, yen per kWh) for the newest complete delivery day (Japan time) that ProofPrice holds, " +
      "from the JEPX spot results file, which we copy once a day. Each half-hour counts as one record. extra.daily lists the daily medians of the recent days we hold and extra.areas the nine area prices of the same day. Exchange prices, not household bills. Negative prices cannot occur on JEPX.",
    describe: (x) =>
      `Wholesale day-ahead electricity in Japan on ${latest.date}: median ${x.median} yen/kWh, typical half-hours between ${x.low} and ${x.high} yen/kWh (system price). Not a household price.`,
    baseUrl: opts.baseUrl,
    extra: s
      ? {
          delivery_day: latest.date,
          cheapest_half_hour_jpy_per_kwh: s.min,
          dearest_half_hour_jpy_per_kwh: s.max,
          areas: areaMedians,
          daily,
          days_held_in_window: daily.length,
          basis: "Day-ahead spot market clearing price per half-hour; household bills add grid fees, levies, taxes and margin. Free tier only (JEPX gives no commercial licence).",
        }
      : undefined,
  });
}

export async function jepxDayAhead(
  input: { country: string; days?: number; baseUrl?: string },
  reader: LibraryReader = libraryReader,
  now: Date = new Date(),
): Promise<PriceAnswer> {
  if (input.country.toUpperCase() !== "JP") throw new SourceError(`JEPX wholesale power: country ${input.country} is not available (JP).`);
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 7)));
  const latest = reader.latest();
  if (!latest) throw new SourceError("Not yet available: ProofPrice collects the JEPX spot prices daily; data appears after the next collection.");
  const from = jstDate(Date.parse(latest.date + "T00:00:00Z") - (days - 1) * DAY);
  const recent = reader.range(from, latest.date);
  return answerFromRows(latest, recent, { days, baseUrl: input.baseUrl });
}

