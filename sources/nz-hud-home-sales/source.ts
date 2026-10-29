// New Zealand home sales: the Ministry of Housing and Urban Development (HUD; now part of the Ministry for Cities, Environment,
// Regions and Transport) "Property and sales statistics" data extract. For every area (New Zealand, 17 regions, 67 territorial
// authorities, 21 Auckland local boards) and every month since 1980 it gives the number of residential sales and the lower quartile,
// median and upper quartile SALE price from the District Valuation Roll (sales by agreement date), as monthly, 3-month rolling and
// 12-month rolling figures. One XLSX of about 27 MB whose link changes every month (the file name carries the month and a hash), so:
//   1. the About page https://www.hud.govt.nz/stats-and-insights/property-and-sales-statistics/about-the-dashboard links the newest file;
//   2. harvest() (run once a day by the collector) downloads it, reads the "Sales" sheet and keeps the newest period of each window;
//   3. answers are read from the price library, never from the 27 MB file.
// Layout checked live on 2026-10-29 from GitHub's servers (workbook "Property-and-Sales-data-download-July-2026.xlsx", sheets
// Instructions, Sales, Sales composition, House Price Index; Sales header: stat_type, area_type, area, period, residential_sales,
// lower_quartile_sale_price, median_sale_price, upper_quartile_sale_price; newest period 2026-07).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";
import { readSheetNamed } from "./xlsx";
import type { Cell } from "./xlsx";

export const ABOUT_URL = "https://www.hud.govt.nz/stats-and-insights/property-and-sales-statistics/about-the-dashboard";
export const COPYRIGHT_URL = "https://www.hud.govt.nz/about-us/copyright-and-disclaimer";
const SITE = "https://www.hud.govt.nz";

export const INFO: SourceInfo = {
  id: "nz-hud-home-sales",
  country: "NZ (New Zealand)",
  category: "home sales (official median sale prices)",
  name: "Property and sales statistics data extract (median and quartile residential sale prices by area)",
  publisher: "Ministry of Housing and Urban Development (HUD), New Zealand (now part of the Ministry for Cities, Environment, Regions and Transport)",
  what_is_recorded:
    "For New Zealand, its 17 regions, 67 territorial authorities and 21 Auckland local boards, for each month, each 3-month rolling window and each 12-month rolling window: " +
    "the number of residential sales and the lower quartile, the median and the upper quartile sale price, taken from the District Valuation Roll (sales by agreement date). " +
    "One published row per area and period; never individual sales or addresses. The publisher leaves the prices blank where an area had too few sales.",
  price_type: "official_statistic",
  freshness: "Monthly; the newest month in the file is about two to three months behind; collected into our price library every day, each answer states its period",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). HUD copyright page: \"this copyright material is licensed for re-use under a Creative Commons Attribution 4.0 International Licence\" (the site's logos and imagery are excluded).",
  licence_url: COPYRIGHT_URL,
  attribution:
    "Source: Ministry of Housing and Urban Development, New Zealand (now the Ministry for Cities, Environment, Regions and Transport), Property and sales statistics, reused under CC BY 4.0. " +
    "Figures are passed on as published; the comparison with New Zealand is calculated by ProofPrice. This is not an endorsement by the Ministry.",
  homepage: ABOUT_URL,
  limits:
    "Residential sales recorded on the District Valuation Roll (houses, apartments and other dwellings together; no split by type of home). The publisher gives the lower quartile, median and upper quartile (an interquartile range, not a 10th-90th range) and the number of sales; prices are per home, not per m². " +
    "Prices are left blank where an area had few sales, so small areas often have no monthly figure; the answer then falls back to the 3-month or 12-month window and says so, and we never publish a figure from fewer than 5 sales. " +
    "The newest months are revised in later releases. Territorial-authority and region names are the publisher's (for example 'Auckland City' is a territorial authority and 'Auckland' the region).",
};

// ---------- the workbook (pure) ----------

export type Stat = "Monthly" | "3-Month rolling" | "12-Month rolling";
export type StatKey = "1m" | "3m" | "12m";
export const STAT_KEY: Record<Stat, StatKey> = { Monthly: "1m", "3-Month rolling": "3m", "12-Month rolling": "12m" };
export const WINDOW_MONTHS: Record<StatKey, number> = { "1m": 1, "3m": 3, "12m": 12 };
export const STAT_KEYS: StatKey[] = ["1m", "3m", "12m"];

export type Level = "national" | "region" | "ta" | "board";
const LEVEL_OF: Record<string, Level> = { National: "national", Region: "region", "Territorial Authority": "ta", "Auckland Local Board": "board" };

export interface SaleRow {
  stat: StatKey;
  level: Level;
  area: string;
  period: string; // YYYY-MM (the month the window ends in)
  sales: number;
  q1: number | null;
  median: number | null;
  q3: number | null;
}

export const SALES_HEADER = ["stat_type", "area_type", "area", "period", "residential_sales", "lower_quartile_sale_price", "median_sale_price", "upper_quartile_sale_price"];

/** An Excel date cell (days since 1899-12-30) or a text date, as YYYY-MM. */
export function periodOf(cell: Cell | undefined): string | null {
  if (typeof cell === "number" && Number.isFinite(cell) && cell > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86400000).toISOString().slice(0, 7);
  if (typeof cell === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(cell.trim());
    if (m) return `${m[1]}-${m[2]}`;
  }
  return null;
}

const money = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) && c > 0 ? c : null);

/** The rows of the "Sales" sheet. Throws if the header is not the one we checked, so a changed layout stops the collector instead of filling the library with nonsense. */
export function parseSalesSheet(rows: Cell[][]): SaleRow[] {
  const header = (rows[0] ?? []).map((c) => (typeof c === "string" ? c.trim() : ""));
  if (SALES_HEADER.some((h, i) => header[i] !== h)) throw new SourceError(`HUD Sales sheet has a new layout: header is ${JSON.stringify(header.slice(0, 8))}`);
  const out: SaleRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const statName = typeof r[0] === "string" ? r[0].trim() : "";
    const stat = (STAT_KEY as Record<string, StatKey>)[statName];
    const level = typeof r[1] === "string" ? LEVEL_OF[r[1].trim()] : undefined;
    const area = typeof r[2] === "string" ? r[2].trim() : "";
    const period = periodOf(r[3]);
    const sales = typeof r[4] === "number" && Number.isFinite(r[4]) ? r[4] : null;
    if (!stat || !level || !area || !period || sales === null) continue;
    out.push({ stat, level, area, period, sales, q1: money(r[5]), median: money(r[6]), q3: money(r[7]) });
  }
  return out;
}

export const areaKey = (level: Level, area: string): string => (level === "national" ? "national" : `${level}|${area}`);
export function parseAreaKey(key: string): { level: Level; area: string } | null {
  if (key === "national") return { level: "national", area: "New Zealand" };
  const i = key.indexOf("|");
  const level = key.slice(0, i) as Level;
  if (i < 0 || !["region", "ta", "board"].includes(level)) return null;
  return { level, area: key.slice(i + 1) };
}

/** The last day of a YYYY-MM month. */
export function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
/** The first day of the window that ends in `period`. */
export function windowStart(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - months, 1)).toISOString().slice(0, 10);
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (period: string): string => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
export function windowWords(period: string, key: StatKey): string {
  if (key === "1m") return monthWords(period);
  return `the ${WINDOW_MONTHS[key]} months to ${monthWords(period)}`;
}
export function windowLabel(period: string, key: StatKey): string {
  if (key === "1m") return monthWords(period);
  return `${WINDOW_MONTHS[key]}-month window ending ${monthWords(period)}`;
}

export const itemOf = (key: StatKey, period: string): string => `${key}/${period}`;

export interface Snapshot {
  date: string; // the end of the newest month
  /** area key -> window -> figure */
  areas: Map<string, { level: Level; name: string; figs: Partial<Record<StatKey, Fig>> }>;
}
export interface Fig {
  period: string;
  n: number;
  q1: number;
  median: number;
  q3: number;
}

/** Pure: the newest period of each window and, for every area with a publishable figure (5+ sales, quartiles ordered), one library row. */
export function snapshotRows(all: SaleRow[]): { date: string; rows: DailyRow[]; periods: Record<StatKey, string>; areas: number } {
  const newest = {} as Record<StatKey, string>;
  for (const key of STAT_KEYS) {
    const nat = all.filter((r) => r.stat === key && r.level === "national" && r.median !== null).map((r) => r.period).sort();
    if (!nat.length) throw new SourceError(`HUD Sales sheet holds no national ${key} median`);
    newest[key] = nat[nat.length - 1];
  }
  const rows: DailyRow[] = [];
  const names = new Set<string>();
  for (const r of all) {
    if (r.period !== newest[r.stat]) continue;
    if (r.sales < MIN_PUBLISH || r.q1 === null || r.median === null || r.q3 === null) continue;
    if (!(r.q1 <= r.median && r.median <= r.q3)) continue;
    rows.push({ area: areaKey(r.level, r.area), item: itemOf(r.stat, r.period), n: r.sales, median: r.median, low: r.q1, high: r.q3, min: r.q1, max: r.q3 });
    names.add(areaKey(r.level, r.area));
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date: monthEnd(newest["1m"]), rows, periods: newest, areas: names.size };
}

/** Pure check that the file adds up: the sales of the 17 regions (which cover the country) against the national count, for the newest month. */
export function reconcile(all: SaleRow[], period: string, key: StatKey = "1m"): { national: number; regions: number; gapPercent: number } {
  const nat = all.find((r) => r.stat === key && r.level === "national" && r.period === period);
  if (!nat) throw new SourceError(`HUD Sales sheet has no national row for ${period}`);
  const regions = all.filter((r) => r.stat === key && r.level === "region" && r.period === period).reduce((s, r) => s + r.sales, 0);
  return { national: nat.sales, regions, gapPercent: Math.round(((regions - nat.sales) / nat.sales) * 10000) / 100 };
}
/** The most the regions' sales may differ from the national count before the collector refuses the file. */
export const MAX_RECONCILE_GAP_PERCENT = 3;

// ---------- the collector ----------

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** The link to the newest workbook on the About page (it changes every month and carries a hash). Pure. */
export function findWorkbookUrl(html: string): string | null {
  for (const m of html.matchAll(/href=["']([^"']*Property-and-Sales[^"']*\.xlsx[^"']*)["']/gi)) {
    const href = m[1].replace(/&amp;/g, "&");
    return href.startsWith("http") ? href : SITE + (href.startsWith("/") ? "" : "/") + href;
  }
  return null;
}

export async function nzHarvest(): Promise<HarvestResult> {
  const page = await fetch(ABOUT_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!page.ok) throw new SourceError(`HUD About page returned HTTP ${page.status}`);
  const url = findWorkbookUrl(await page.text());
  if (!url) throw new SourceError("HUD About page no longer links a Property-and-Sales .xlsx file");
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(240_000) });
  if (!res.ok) throw new SourceError(`HUD workbook returned HTTP ${res.status}`);
  const sheet = readSheetNamed(Buffer.from(await res.arrayBuffer()), "Sales");
  if (!sheet) throw new SourceError("HUD workbook has no 'Sales' sheet");
  const all = parseSalesSheet(sheet.rows);
  const snap = snapshotRows(all);
  const rec = reconcile(all, snap.periods["1m"]);
  if (Math.abs(rec.gapPercent) > MAX_RECONCILE_GAP_PERCENT) {
    throw new SourceError(`HUD Sales sheet does not add up: regions sum to ${rec.regions} sales, New Zealand says ${rec.national} for ${snap.periods["1m"]} (${rec.gapPercent}% apart)`);
  }
  if (snap.areas < 80) throw new SourceError(`Only ${snap.areas} HUD areas had a publishable figure; the file looks incomplete or changed`);
  return {
    date: snap.date,
    currency: "NZD",
    unit: "per home",
    rows: snap.rows,
    note:
      `HUD Property and sales statistics (${url.split("?")[0].split("/").pop()}): newest periods ${STAT_KEYS.map((k) => `${k} ${snap.periods[k]}`).join(", ")}; ${snap.rows.length} rows over ${snap.areas} areas with 5+ sales. ` +
      `low and high are the lower and upper QUARTILE (HUD publishes quartiles, not deciles); min and max repeat them. n is the number of residential sales. ` +
      `Check: regions' sales sum to ${rec.regions} against ${rec.national} for New Zealand in ${snap.periods["1m"]} (${rec.gapPercent}% apart).`,
  };
}

// ---------- the library snapshot ----------

export function snapshotFromRows(date: string, rows: LibraryRow[]): Snapshot {
  const areas: Snapshot["areas"] = new Map();
  for (const r of rows) {
    const a = parseAreaKey(r.area);
    const m = /^(1m|3m|12m)\/(\d{4}-\d{2})$/.exec(r.item);
    if (!a || !m || !Number.isFinite(r.n)) continue;
    const cur = areas.get(r.area) ?? { level: a.level, name: a.area, figs: {} };
    cur.figs[m[1] as StatKey] = { period: m[2], n: r.n, q1: r.low, median: r.median, q3: r.high };
    areas.set(r.area, cur);
  }
  return { date, areas };
}

let cache: { key: string; snap: Snapshot } | null = null;
/** The newest snapshot in the library, or null if the collector has not stored one yet. */
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta || !day) return null;
  const key = `${day.date}:${day.rows.length}:${meta.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const snap = snapshotFromRows(day.date, day.rows);
  cache = { key, snap };
  return snap;
}

// ---------- places (pure) ----------

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const stripTa = (folded: string): string => folded.replace(/ (district|city)$/, "");

export interface Place {
  key: string;
  level: Level;
  name: string;
}
export interface Found {
  place: Place;
  /** Other places the same words could mean (a city and its region), for the answer's notes. */
  alsoAvailable: Place[];
}

const NATIONAL_WORDS = new Set(["", "new zealand", "nz", "aotearoa", "aotearoa new zealand", "national", "whole country", "all"]);

export function placesOf(snap: Snapshot): Place[] {
  return [...snap.areas.entries()].map(([key, a]) => ({ key, level: a.level, name: a.name }));
}

const LEVEL_WORDS: Record<Level, string> = { national: "New Zealand", region: "region", ta: "territorial authority", board: "Auckland local board" };
export const levelWords = (l: Level): string => LEVEL_WORDS[l];

/**
 * Words to a place. Order: New Zealand; a territorial authority by its official name or without 'City' or 'District' (a city beats the region that
 * shares its name, like the MBIE rents source does; 'Wellington region' asks for the region); an Auckland local board; a region; a unique start of a
 * name (four letters or more). Names carry macrons in the file, so words are folded to plain letters.
 */
export function findPlace(input: string | undefined, places: Place[]): Found | null {
  let q = fold(input ?? "").replace(/ (new zealand|nz)$/, "").replace(/ council$/, "");
  if (NATIONAL_WORDS.has(q)) {
    const nat = places.find((p) => p.level === "national");
    return nat ? { place: nat, alsoAvailable: [] } : null;
  }
  const regionWord = / region$/.test(q);
  if (regionWord) q = q.replace(/ region$/, "");
  const byLevel = (l: Level) => places.filter((p) => p.level === l);
  const taExact = byLevel("ta").filter((p) => fold(p.name) === q);
  const taStripped = byLevel("ta").filter((p) => stripTa(fold(p.name)) === q);
  const board = byLevel("board").filter((p) => fold(p.name) === q);
  const region = byLevel("region").filter((p) => fold(p.name) === q);
  const ordered = regionWord ? region : [...taExact, ...taStripped, ...board, ...region];
  const seen = new Set<string>();
  const unique = ordered.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
  if (unique.length) return { place: unique[0], alsoAvailable: unique.slice(1) };
  if (q.length >= 4) {
    const starts = places.filter((p) => p.level !== "national" && (fold(p.name).startsWith(q) || stripTa(fold(p.name)).startsWith(q)));
    if (starts.length === 1) return { place: starts[0], alsoAvailable: [] };
  }
  return null;
}

// ---------- the request (pure) ----------

/** months -> window: 1 = the month, 2 to 6 = 3-month rolling, 7 or more (and the default 12) = 12-month rolling. */
export function windowFor(months: number | undefined): StatKey {
  if (months === undefined || !Number.isFinite(months)) return "12m";
  if (months <= 1) return "1m";
  if (months <= 6) return "3m";
  return "12m";
}

export interface NzQuery {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}

export function nzAnswer(q: NzQuery, snap: Snapshot): PriceAnswer {
  if (q.property_type && q.property_type.toLowerCase() !== "any") {
    throw new InputError("NZ: the publisher gives one figure for all residential sales; property_type must be left out or 'any'.");
  }
  if (q.postcode && !q.town) throw new InputError("NZ: postcodes are not supported. Give a town, city, region or Auckland local board as town (or leave it out for New Zealand).");
  const places = placesOf(snap);
  const found = findPlace(q.town, places);
  if (!found) {
    const example = places.filter((p) => p.level === "ta").slice(0, 6).map((p) => p.name).join(", ");
    throw new InputError(
      `'${q.town}' is not an area in HUD's New Zealand sale statistics. Use a territorial authority or city (for example ${example}), a region (Canterbury), an Auckland local board (Howick), or leave town out for New Zealand.`,
    );
  }
  const area = snap.areas.get(found.place.key)!;
  const asked = windowFor(q.months);
  const order: StatKey[] = asked === "1m" ? ["1m", "3m", "12m"] : asked === "3m" ? ["3m", "12m"] : ["12m"];
  const key = order.find((k) => area.figs[k]);
  const label = found.place.level === "national" ? "New Zealand" : found.place.name;
  const query = { country: "NZ", town: label, months: WINDOW_MONTHS[asked] };
  if (!key) {
    return buildStatisticAnswer({
      source: INFO,
      query,
      value: null,
      measure: "median",
      currency: "NZD",
      unit: "per home",
      period: { from: null, to: null },
      reference_period: "n/a",
      method: METHOD,
      describe: () => "",
      baseUrl: q.baseUrl,
      note: `HUD publishes no sale price for ${label} in ${windowWords(snap.date.slice(0, 7), asked)}: fewer than 5 sales, or too few for the publisher to release prices.`,
    });
  }
  const fig = area.figs[key]!;
  const notes: string[] = [];
  if (key !== asked) {
    notes.push(
      `HUD publishes no ${asked === "1m" ? "monthly" : "3-month"} price for ${label} (too few sales), so this is the figure for ${windowWords(fig.period, key)}.`,
    );
  }
  if (q.months !== undefined && ![1, 3, 12].includes(q.months)) {
    notes.push(`HUD publishes monthly, 3-month and 12-month figures only; months=${q.months} is answered with the ${WINDOW_MONTHS[key]}-month figure.`);
  }
  if (found.alsoAvailable.length) {
    notes.push(`'${q.town}' also names ${found.alsoAvailable.map((p) => `${p.name} (${levelWords(p.level)})`).join(" and ")}; ask for that name to get it.`);
  }
  if (q.postcode) notes.push("Postcodes are not used; the figure is for the named area.");
  const nat = snap.areas.get("national")?.figs[key];
  const comparison =
    nat && found.place.level !== "national" && nat.period === fig.period
      ? { median: nat.median, period: windowLabel(nat.period, key), difference_percent: Math.round((fig.median / nat.median - 1) * 1000) / 10 }
      : undefined;
  const other = STAT_KEYS.filter((k) => k !== key && area.figs[k]).map((k) => ({
    window: `${WINDOW_MONTHS[k]} month${k === "1m" ? "" : "s"}`,
    reference_period: windowLabel(area.figs[k]!.period, k),
    median: area.figs[k]!.median,
    sales: area.figs[k]!.n,
  }));
  const out = buildStatisticAnswer({
    source: INFO,
    query,
    value: fig.median,
    measure: "median",
    currency: "NZD",
    unit: "per home",
    period: { from: windowStart(fig.period, WINDOW_MONTHS[key]), to: monthEnd(fig.period) },
    reference_period: windowLabel(fig.period, key),
    sample_size: fig.n,
    method: METHOD,
    baseUrl: q.baseUrl,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${label} the median price of residential sales (per home, not per m²) was ${fmtMoney(v, "NZD")} in ${windowWords(fig.period, key)}, from ${fig.n.toLocaleString("en-GB")} sales; ` +
      `half of the sales were between ${fmtMoney(fig.q1, "NZD")} and ${fmtMoney(fig.q3, "NZD")} (lower to upper quartile).` +
      (comparison ? ` The New Zealand median for the same period was ${fmtMoney(comparison.median, "NZD")} (${label} is ${Math.abs(comparison.difference_percent)}% ${comparison.difference_percent >= 0 ? "above" : "below"} it).` : ""),
    extra: {
      area: { name: found.place.name, level: levelWords(found.place.level) },
      sales: fig.n,
      interquartile_range: { lower_quartile: fig.q1, upper_quartile: fig.q3, note: "HUD publishes the lower and upper quartile (25th and 75th percentile); this is not a 10th-90th range." },
      window_months: WINDOW_MONTHS[key],
      reference_period_label: windowLabel(fig.period, key),
      ...(comparison ? { new_zealand_comparison: comparison } : {}),
      ...(other.length ? { other_windows: other } : {}),
      library_snapshot_date: snap.date,
      dataset: { page: ABOUT_URL },
    },
  });
  return { ...out, confidence: confidenceLabel(fig.n) };
}

export const METHOD =
  "New Zealand: the median sale price, lower and upper quartile and number of residential sales that the Ministry of Housing and Urban Development publishes per area (New Zealand, region, territorial authority, Auckland local board) " +
  "for a month, a 3-month rolling and a 12-month rolling window, from the District Valuation Roll by sale agreement date. We collect the newest period of each window from HUD's workbook once a day and answer from that copy; HUD's figures are passed on unchanged. " +
  "Without months the 12-month figure is returned, because small areas have too few sales for a monthly price.";

export async function nzHomeSales(q: NzQuery): Promise<PriceAnswer> {
  const snap = loadSnapshot();
  if (!snap) throw new SourceError("The New Zealand home-sales library copy is not available yet: the daily collector has not stored a snapshot");
  return nzAnswer(q, snap);
}
