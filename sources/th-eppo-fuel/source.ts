// Thailand fuel: EPPO (Energy Policy and Planning Office, Ministry of Energy) retail oil prices. One CSV on catalog.eppo.go.th, long format,
// every month since January 2003: Year, Month (English name), Product, Price (MIN / WT.AVG / MAX across brands), Value, UNIT.
// Format checked live on 2026-10-29 from GitHub's servers (probe th-eppo-head: 200 text/csv, 544,816 bytes, UTF-8 BOM, file modified 2026-10-08);
// fixtures/eppo-sample.csv holds the first rows copied from it. The file is read once per request (the CDN caches answers for 10 minutes)
// and the newest month in it is used, so a file that stops early is reported by its date, never hidden.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const PAGE_URL = "https://catalog.eppo.go.th/dataset/33ee54ae-0967-46a5-945d-40cdb12cda4f";
export const CSV_URL =
  "https://catalog.eppo.go.th/dataset/33ee54ae-0967-46a5-945d-40cdb12cda4f/resource/079c3c22-d46d-4c05-965f-17d44b922e53/download/dataset_11_58.csv";

export const INFO: SourceInfo = {
  id: "th-eppo-fuel",
  country: "TH (Thailand)",
  category: "fuel (monthly national retail price)",
  name: "Retail oil prices (EPPO open data, dataset_11_58)",
  publisher: "Energy Policy and Planning Office (EPPO), Ministry of Energy, Thailand",
  what_is_recorded:
    "For each month since January 2003, the lowest, weighted-average and highest national retail price across fuel brands of gasohol/gasoline (ULG 95, UGR 91), diesel (HSD B7, LSD), kerosene, fuel oil and LPG, in Thai baht per litre or kilogram.",
  price_type: "official_statistic",
  freshness: "Monthly national retail prices; the file is updated by EPPO when a new month is added (check the period in each answer)",
  licence:
    "EPPO open data catalogue record: licence listed as 'Open Data Common' (Thai government open data licence). The licence text was not read by ProofPrice: free tier only, no paid use.",
  licence_url: PAGE_URL,
  attribution: "Source: Energy Policy and Planning Office (EPPO), Ministry of Energy, Thailand, Retail oil prices (catalog.eppo.go.th). Figures passed on as published; changes on the month and year are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "A national monthly price across brands (the weighted average, with the lowest and highest brand price in the extras), not a price at a station: no town, region or sample size. " +
    "Prices are posted retail prices, not receipts. The licence label is 'Open Data Common' and has not been verified, so this source stays on the free tier.",
};

export interface Point {
  period: string; // YYYY-MM
  product: string;
  stat: string; // MIN | WT.AVG | MAX
  value: number;
  unit: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Rows of the EPPO table. Throws SourceError when the layout is not the one we know. */
export function parseEppo(text: string): Point[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.length ? lines[0].split(",").map((h) => h.trim().toLowerCase()) : [];
  const want = ["year", "month", "product", "price", "value", "unit"];
  if (want.some((w, i) => head[i] !== w)) {
    throw new SourceError("EPPO changed the layout of the retail oil price table (expected Year, Month, Product, Price, Value, UNIT); this source needs updating.");
  }
  const out: Point[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(",").map((x) => x.trim());
    if (c.length < 6) continue;
    const m = MONTHS.indexOf(c[1].toLowerCase());
    const y = Number(c[0]);
    const v = Number(c[4]);
    if (m < 0 || !Number.isInteger(y) || y < 1990 || y > 2100 || !Number.isFinite(v) || v <= 0) continue;
    out.push({ period: `${y}-${String(m + 1).padStart(2, "0")}`, product: c[2], stat: c[3].toUpperCase(), value: v, unit: c[5] });
  }
  return out;
}

/** The EPPO product each ProofPrice fuel is answered with. */
export const SERIES: Record<string, { product: string; label: string; unit: string; per: string }> = {
  petrol95: { product: "ULG 95", label: "unleaded gasoline 95 (ULG 95)", unit: "Baht/Litre", per: "per litre" },
  diesel: { product: "HSD B7", label: "high-speed diesel B7", unit: "Baht/Litre", per: "per litre" },
  lpg: { product: "LPG AUTOMOBILE (B/L)", label: "automotive LPG", unit: "Baht/Litre", per: "per litre" },
};
const EXTRA_PRODUCTS: Record<string, string> = { "UGR 91": "unleaded_gasoline_91", KEROSENE: "kerosene" };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const baht = (v: number) => `${v.toFixed(2)} baht`;

function shiftMonth(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
function lastDay(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export interface Change {
  from: string;
  value: number;
  absolute: number;
  percent: number;
}

function valueOf(points: Point[], product: string, stat: string, period: string): number | null {
  const p = points.find((x) => x.product === product && x.stat === stat && x.period === period);
  return p ? p.value : null;
}

export function changeFor(points: Point[], product: string, latest: string, months: number): Change | null {
  const from = shiftMonth(latest, -months);
  const now = valueOf(points, product, "WT.AVG", latest);
  const then = valueOf(points, product, "WT.AVG", from);
  if (now == null || then == null) return null;
  return { from, value: then, absolute: r3(now - then), percent: Math.round(((now - then) / then) * 1000) / 10 };
}

/** Newest month that has a weighted-average price for the product. */
export function latestPeriod(points: Point[], product: string): string | null {
  let best: string | null = null;
  for (const p of points) if (p.product === product && p.stat === "WT.AVG" && (!best || p.period > best)) best = p.period;
  return best;
}

const move = (c: Change | null, what: string) =>
  c ? `${c.percent > 0 ? "up" : c.percent < 0 ? "down" : "unchanged"}${c.percent === 0 ? "" : ` ${Math.abs(c.percent)}%`} on ${what} (${baht(c.value)} in ${c.from})` : `no figure for ${what}`;

export const METHOD =
  "Thailand fuel: EPPO's national retail price (weighted average across brands, Thai baht per litre) for the newest month in its open data table, with the lowest and highest brand price, " +
  "and the change on the month before and on the same month a year earlier. An official monthly statistic for the whole country, not a station price.";

export interface ThFuelInput {
  fuel?: string;
  town?: string;
  area?: string;
  postcode?: string;
  baseUrl?: string;
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export function answerFromPoints(points: Point[], input: ThFuelInput): PriceAnswer {
  const fuel = input.fuel === "petrol98" ? "petrol95" : input.fuel ?? "";
  const series = SERIES[fuel];
  if (!series) throw new InputError("Thailand: fuel must be petrol95 (ULG 95), diesel or lpg (automotive LPG, per litre). EPPO's gasoline 91 and kerosene prices are in extra.other_products.");
  const place = input.town || input.area || input.postcode;
  const query = { country: "TH", fuel: input.fuel ?? fuel, ...(place ? { place } : {}) };
  const latest = latestPeriod(points, series.product);
  if (!latest) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "THB", unit: series.per,
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const value = valueOf(points, series.product, "WT.AVG", latest)!;
  const low = valueOf(points, series.product, "MIN", latest);
  const high = valueOf(points, series.product, "MAX", latest);
  const month = changeFor(points, series.product, latest, 1);
  const year = changeFor(points, series.product, latest, 12);
  const others: Record<string, { weighted_average_baht_per_litre: number }> = {};
  for (const [prod, key] of Object.entries(EXTRA_PRODUCTS)) {
    const v = valueOf(points, prod, "WT.AVG", latest);
    if (v != null) others[key] = { weighted_average_baht_per_litre: v };
  }
  const note =
    (input.fuel === "petrol98" ? "EPPO has no 98 series; this is ULG 95. " : "") +
    (place ? `EPPO publishes one national price only; '${place}' is answered with the Thailand average. ` : "");
  return buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "THB",
    unit: series.per,
    period: { from: `${latest}-01`, to: lastDay(latest) },
    reference_period: latest,
    method: METHOD,
    note: note.trim() || undefined,
    describe: (v) =>
      `The national weighted-average retail price of ${series.label} in Thailand was ${baht(v)} per litre in ${latest}, ` +
      `${move(month, "the month before")} and ${move(year, "a year earlier")}.`,
    baseUrl: input.baseUrl,
    extra: {
      month: latest,
      lowest_brand_price: low,
      highest_brand_price: high,
      change_on_month: month,
      change_on_year: year,
      other_products: others,
      ...(place ? { place_note: "national figure only" } : {}),
    },
  });
}

export async function thFuel(input: ThFuelInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  return answerFromPoints(parseEppo(await fetcher(CSV_URL)), input);
}

// ---------- daily collector (stale-if-error copy and history) ----------
// Once a day the collector stores EPPO's newest month: one row per fuel the tool can be asked for (petrol95, diesel, lpg), n NO_COUNT because EPPO
// gives one national figure and no record count. Rows are dated by the first day of the month the figure is for (referenceDates).

export function harvestRows(points: Point[]): HarvestResult {
  const rows = [];
  let date = "";
  for (const item of ["petrol95", "diesel", "lpg"] as const) {
    const s = SERIES[item];
    const latest = latestPeriod(points, s.product);
    if (!latest) continue;
    const v = valueOf(points, s.product, "WT.AVG", latest)!;
    const lo = valueOf(points, s.product, "MIN", latest) ?? v;
    const hi = valueOf(points, s.product, "MAX", latest) ?? v;
    if (`${latest}-01` > date) date = `${latest}-01`;
    rows.push({ area: "TH", item, n: NO_COUNT, median: v, low: lo, high: hi, min: lo, max: hi });
  }
  if (!rows.length) throw new SourceError("EPPO retail oil price table holds no ULG 95, HSD B7 or LPG price");
  return {
    date,
    currency: "THB",
    unit: "per litre",
    rows,
    note: "EPPO retail oil prices: national weighted-average price per litre in baht for ULG 95, HSD B7 diesel and automotive LPG for the newest month (low/high = lowest and highest brand price). Published statistics, not counts of records.",
  };
}

export async function thFuelHarvest(fetcher: (url: string) => Promise<string> = fetchText): Promise<HarvestResult> {
  return harvestRows(parseEppo(await fetcher(CSV_URL)));
}

export function thFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  const item = p.fuel === "petrol98" ? "petrol95" : p.fuel;
  return item === "diesel" || item === "petrol95" || item === "lpg" ? { area: "TH", item, label: "Thailand (national average)" } : null;
}
