// British Columbia (Canada) home sales from the Property Transfer Tax statistics of the BC Ministry of Finance, on the BC Data Catalogue (CKAN).
// One dataset per year (property-transfer-tax-data-<year>); its CSV "Municipal Monthly <year>" has one row per municipality (or rural area) and
// month with the number of residential transfers (n_res_trans) and their total declared fair market value (sum_FMV_res). Checked live on
// 2026-10-21 through the GitHub probe (bcptt-1, bcptt-2): 402 KB, columns by name (see fixtures.ts), 'nr' = suppressed, dot decimals, Month 1-12.
//
// It is a bulk file, so it is never downloaded per request: harvest() (run once a day by the collector) turns it into rolling 3-month and
// 12-month averages per municipality, regional district and for the province, and answers are read from the price library.
// What a figure is: total declared fair market value / number of residential transfers. An AVERAGE, not a median (BC publishes no residential
// median), and a value declared on a tax return (close to, but not the same as, the price on a receipt). Foreign-buyer columns are never read.

import { ckanPackage, latestResource } from "../../lib/adapters/ckan";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const SITE = "https://catalogue.data.gov.bc.ca";
export const DATASET_PREFIX = "property-transfer-tax-data-";
export const LICENCE_URL = "https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61";

export const INFO: SourceInfo = {
  id: "ca-bc-ptt",
  country: "CA (British Columbia)",
  category: "home sales (average declared value of residential property transfers)",
  name: "Property Transfer Tax data: residential transfers by municipality and month",
  publisher: "Government of British Columbia, Ministry of Finance (BC Data Catalogue)",
  what_is_recorded:
    "For every municipality and rural area of British Columbia and every month: the number of residential property transfers (houses, strata/condo units, acreages, rentals) and their total fair market value as declared on the Property Transfer Tax returns. Counts and totals only; never one transfer, one address or one buyer.",
  price_type: "official_statistic",
  freshness: "Monthly files updated through the year, a few weeks to a few months behind; collected into our price library every day, each answer states its period",
  licence:
    "Open Government Licence - British Columbia v2.0: \"grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes\"",
  licence_url: LICENCE_URL,
  attribution:
    "Contains information licensed under the Open Government Licence - British Columbia. Source: Government of British Columbia, Ministry of Finance, Property Transfer Tax data. The average is calculated by ProofPrice from the totals and counts published.",
  homepage: "https://catalogue.data.gov.bc.ca/dataset/property-transfer-tax-data-2026",
  limits:
    "The value is the fair market value declared on the Property Transfer Tax return, which usually follows the price paid but is not a receipt. " +
    "It is an average (total value divided by number of transfers), not a median, so a few very expensive homes pull it up; BC publishes no residential median or percentiles. " +
    "All residential kinds are mixed (houses, strata units, acreages); the file does not split the value by kind. Figures are for municipalities and rural areas as BC groups them (for example 'Quesnel Rural' is separate from 'City of Quesnel'). " +
    "We publish nothing from fewer than 5 transfers. Foreign-buyer figures in the file are not used.",
};

// ---------- the file (pure) ----------

export interface MonthRow {
  year: number;
  month: number;
  district: string; // regional district, number removed: "Cariboo"
  name: string; // municipality, number removed: "City of Quesnel"
  n: number; // residential transfers
  value: number; // total declared fair market value of those transfers, CAD
}

/** One CSV line into cells (double quotes understood). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else f += c;
  }
  out.push(f);
  return out;
}

/** "470 - City of Quesnel" -> "City of Quesnel"; "572 -" -> "". */
export const stripCode = (s: string) => s.replace(/^\s*\d+\s*-\s*/, "").trim();

const cell = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null; // 'nr' and blanks
  return Number(t);
};

const REQUIRED = ["RegionalDistrict", "Municipality", "Year", "Month", "n_res_trans", "sum_FMV_res"];

/** Parse municipal_monthly_<year>.csv. Columns are found by name. Throws SourceError if the layout is not recognised. Rows with no name or a non-number are skipped. */
export function parseMunicipalMonthly(text: string): MonthRow[] {
  const lines = text.split("\n");
  const head = splitCsvLine((lines[0] ?? "").replace(/^﻿/, "").replace(/\r$/, "")).map((c) => c.trim());
  const at = (n: string) => head.indexOf(n);
  for (const c of REQUIRED) if (at(c) < 0) throw new SourceError(`BC property transfer tax file has an unexpected layout (no ${c} column)`);
  const [iRd, iMun, iY, iM, iN, iV] = REQUIRED.map(at);
  const out: MonthRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const c = splitCsvLine(line);
    const year = cell(c[iY]);
    const month = cell(c[iM]);
    const n = cell(c[iN]);
    const value = cell(c[iV]);
    const name = stripCode(c[iMun] ?? "");
    if (year === null || month === null || month < 1 || month > 12 || n === null || value === null || !name) continue;
    out.push({ year, month, district: stripCode(c[iRd] ?? ""), name, n, value });
  }
  return out;
}

// ---------- windows and rows (pure) ----------

const ym = (year: number, month: number) => year * 12 + (month - 1);
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const firstDay = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);

export const AREA_SEP = "|";
export const WINDOWS = [3, 12] as const;
export const itemOf = (months: number) => `residential/${months}m`;

export interface Snapshot {
  date: string; // last day of the newest month
  newest: { year: number; month: number };
  rows: DailyRow[];
  windows: number[];
}

/**
 * Rolling averages ending at the newest month that has any residential transfer. A window is kept only when every month of it is in the files.
 * Areas: "ALL" (the whole province, every row of the file), "rd|<district>", "m|<municipality or rural area>". A cell needs at least 5 transfers.
 */
export function snapshotOf(all: MonthRow[]): Snapshot {
  const withSales = all.filter((r) => r.n > 0);
  if (!withSales.length) throw new SourceError("BC property transfer tax file holds no residential transfers to harvest");
  const newestIdx = Math.max(...withSales.map((r) => ym(r.year, r.month)));
  const newest = { year: Math.floor(newestIdx / 12), month: (newestIdx % 12) + 1 };
  const present = new Set(all.map((r) => ym(r.year, r.month)));
  const rows: DailyRow[] = [];
  const windows: number[] = [];
  for (const w of WINDOWS) {
    let complete = true;
    for (let k = 0; k < w; k++) if (!present.has(newestIdx - k)) complete = false;
    if (!complete) continue;
    windows.push(w);
    const groups = new Map<string, { n: number; v: number }>();
    const add = (area: string, r: MonthRow) => {
      const g = groups.get(area) ?? { n: 0, v: 0 };
      g.n += r.n;
      g.v += r.value;
      groups.set(area, g);
    };
    for (const r of all) {
      const idx = ym(r.year, r.month);
      if (idx > newestIdx || idx <= newestIdx - w) continue;
      add(NATIONAL, r);
      if (r.district) add(`rd${AREA_SEP}${r.district}`, r);
      add(`m${AREA_SEP}${r.name}`, r);
    }
    for (const [area, g] of groups) {
      if (g.n < MIN_PUBLISH || !(g.v > 0)) continue;
      const mean = Math.round(g.v / g.n);
      rows.push({ area, item: itemOf(w), n: g.n, median: mean, low: mean, high: mean, min: mean, max: mean });
    }
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date: lastDay(newest.year, newest.month), newest, rows, windows };
}

// ---------- the collector ----------

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
export const harvestOptions = { retryDelayMs: 2000 };

async function getText(url: string, tries = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90_000) });
      if (res.ok) return await res.text();
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The URL of the "Municipal Monthly <year>" CSV in the dataset of that year, or null if there is no dataset or file yet. */
export async function municipalCsvUrl(year: number): Promise<string | null> {
  let pkg;
  try {
    pkg = await ckanPackage(SITE, `${DATASET_PREFIX}${year}`);
  } catch {
    return null;
  }
  return latestResource(pkg.resources, { format: "CSV", nameMatches: /municipal\s+monthly/i })?.url ?? null;
}

/** The daily collector: this year's and last year's municipal monthly CSV, turned into rolling 3- and 12-month averages. */
export async function bcHarvest(): Promise<HarvestResult> {
  const year = new Date().getUTCFullYear();
  const rows: MonthRow[] = [];
  let got = 0;
  for (const y of [year, year - 1]) {
    const url = await municipalCsvUrl(y);
    if (!url) continue;
    rows.push(...parseMunicipalMonthly(await getText(url)));
    got++;
  }
  if (!got) throw new SourceError("No Municipal Monthly CSV found in the BC property transfer tax datasets");
  const snap = snapshotOf(rows);
  if (!snap.rows.length) throw new SourceError("BC property transfer tax file gave no area with at least 5 residential transfers");
  return {
    date: snap.date,
    currency: "CAD",
    unit: "per home (average declared fair market value)",
    rows: snap.rows,
    note:
      `Average declared fair market value of residential property transfers (total value / number of transfers) in the ${snap.windows.join("- and ")}-month windows ending ${snap.date}; n is the number of residential transfers. ` +
      "median, low, high, min and max all repeat the average because BC publishes no median or percentiles. Areas: ALL (province), rd|<regional district>, m|<municipality or rural area>.",
  };
}

// ---------- places (pure) ----------

export interface Place {
  key: string; // library area key
  kind: "province" | "district" | "municipality";
  label: string; // "City of Quesnel"
  short: string; // "Quesnel"
}

/** Lower case, accents removed, punctuation to single spaces. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

const TYPE_PREFIX = /^(?:the\s+)?(?:city|district|town|village|township|resort municipality|mountain resort municipality|regional municipality|municipality|corporation|island municipality)\s+of\s+/i;
export const shortName = (label: string) => label.replace(TYPE_PREFIX, "").trim();

export function parseArea(key: string): Place | null {
  if (key === NATIONAL) return { key, kind: "province", label: "British Columbia", short: "British Columbia" };
  const [k, ...rest] = key.split(AREA_SEP);
  const label = rest.join(AREA_SEP);
  if (!label) return null;
  if (k === "rd") return { key, kind: "district", label: `${label} regional district`, short: label };
  if (k === "m") return { key, kind: "municipality", label, short: shortName(label) };
  return null;
}

/** What people say -> the folded name BC uses. */
export const ALIASES: Record<string, string> = {
  "metro vancouver": "greater vancouver",
  "greater vancouver": "greater vancouver",
  "gvrd": "greater vancouver",
  "capital region": "capital",
  "greater victoria": "capital",
  "north okanagan": "north okanagan",
  "thompson nicola": "thompson nicola",
  "kamloops": "kamloops",
  "fraser valley": "fraser valley",
  "sunshine coast": "sunshine coast",
};
const PROVINCE = new Set(["bc", "b c", "british columbia", "province", "whole province", "all"]);

/** Find the place the caller means among the areas held in the library. Empty text = the province. Throws InputError if none or several. */
export function resolvePlace(text: string | undefined, places: Place[]): Place {
  const raw = (text ?? "").trim();
  const province = places.find((p) => p.kind === "province");
  if (!raw || PROVINCE.has(fold(raw))) {
    if (!province) throw new SourceError("Not yet available: the BC province total is not in the library.");
    return province;
  }
  const q = fold(raw).replace(/\b(british columbia|bc|b c|canada)\b/g, " ").replace(/\s+/g, " ").trim();
  const want = ALIASES[q] ?? q;
  const stages: ((p: Place) => boolean)[] = [
    (p) => p.kind === "municipality" && fold(p.short) === want,
    (p) => p.kind === "municipality" && fold(p.label) === want,
    (p) => p.kind === "district" && fold(p.short) === want,
    (p) => p.kind === "municipality" && want.length >= 4 && new RegExp(`\\b${want}\\b`).test(fold(p.short)),
    (p) => p.kind === "district" && want.length >= 4 && new RegExp(`\\b${want}\\b`).test(fold(p.short)),
  ];
  for (const stage of stages) {
    const hits = places.filter(stage);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const names = hits.slice(0, 8).map((h) => h.label).join("; ");
      throw new InputError(`Give a more exact BC place: '${raw}' matches several (${names}).`);
    }
  }
  throw new InputError(
    `Give a British Columbia municipality, rural area or regional district as town (for example Kelowna, Victoria, Surrey, Prince George, 'Quesnel Rural', Greater Vancouver); '${raw}' is not one BC publishes figures for with at least ${MIN_PUBLISH} transfers.`,
  );
}

// ---------- answering ----------

export interface BcInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const METHOD =
  "The BC Ministry of Finance publishes, for every municipality and rural area and every month, the number of residential property transfers and their total fair market value as declared for the Property Transfer Tax. " +
  "ProofPrice's collector reads the files once a day and computes the average declared value per residential transfer (total value divided by number of transfers) for the latest 3 or 12 months, per municipality, regional district and for the province. " +
  "The number of transfers is the sample size; an area with fewer than 5 gets no figure. It is an average, not a median (BC publishes no residential median or range), and a declared value, not a receipt.";

export interface Candidate {
  months: number;
  row: DailyRow;
}

const windowLabel = (date: string, months: number) => {
  const [y, m] = date.split("-").map(Number);
  const startIdx = ym(y, m) - (months - 1);
  const sy = Math.floor(startIdx / 12);
  const sm = (startIdx % 12) + 1;
  return { from: firstDay(sy, sm), reference: months === 1 ? `${y}-${String(m).padStart(2, "0")}` : `${sy}-${String(sm).padStart(2, "0")} to ${y}-${String(m).padStart(2, "0")}`, words: `${MONTH_NAMES[sm - 1]} ${sy} to ${MONTH_NAMES[m - 1]} ${y}` };
};

/** Pure: the answer for a place from its candidate library rows (3m and/or 12m), the date of the harvest and the window the caller asked for (0 = choose). */
export function answerFromCandidates(place: Place, cands: Candidate[], date: string, asked: number, baseUrl?: string): PriceAnswer {
  const query = { country: "CA", region: "BC", place: place.label };
  const usable = cands.filter((c) => c.row.n >= MIN_PUBLISH && c.row.median > 0);
  const by = (m: number) => usable.find((c) => c.months === m);
  let pick: Candidate | undefined;
  if (asked) pick = by(asked <= 4 ? 3 : 12) ?? usable[0];
  else pick = by(3) && by(3)!.row.n >= 10 ? by(3) : by(12) ?? by(3);
  if (!pick) {
    return buildStatisticAnswer({
      source: INFO,
      query,
      value: null,
      measure: "average",
      currency: "CAD",
      unit: "per home (average declared fair market value)",
      period: { from: null, to: null },
      reference_period: "",
      method: METHOD,
      describe: () => "",
      baseUrl,
      extra: { hint: `${place.label} had fewer than ${MIN_PUBLISH} residential property transfers in the latest 12 months, so no figure is published. Try the regional district or the province.` },
    });
  }
  const w = windowLabel(date, pick.months);
  const other = usable.find((c) => c !== pick);
  const where = place.kind === "province" ? "British Columbia" : place.label;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: pick.row.median,
    measure: "average",
    currency: "CAD",
    unit: "per home (average declared fair market value)",
    period: { from: w.from, to: date },
    reference_period: w.reference,
    sample_size: pick.row.n,
    method: METHOD,
    describe: (v) =>
      `Homes transferred in ${where} had an average declared fair market value of ${fmtMoney(v, "CAD")} over ${w.words} (${pick!.months} months), from ${pick!.row.n} residential property transfers. ` +
      "It is an average, not a median, of values declared on Property Transfer Tax returns; the mix of houses, strata (condo) units and acreages is not split out.",
    ending: "Average calculated by ProofPrice from the totals and counts the Government of British Columbia publishes.",
    baseUrl,
    extra: {
      place_kind: place.kind,
      window_months: pick.months,
      residential_transfers: pick.row.n,
      ...(other ? { other_window: { window_months: other.months, average_declared_value: other.row.median, residential_transfers: other.row.n } } : {}),
      basis: "Fair market value declared on the Property Transfer Tax return; residential transfers of every kind combined.",
    },
  });
}

export async function bcHomeSales(input: BcInput): Promise<PriceAnswer> {
  if (input.postcode && input.postcode.trim()) {
    throw new InputError("BC publishes by municipality, not postcode: give the municipality or regional district as town (for example Kelowna).");
  }
  const pt = (input.property_type ?? "any").toLowerCase();
  if (pt !== "any") {
    throw new InputError("property_type must be 'any' for British Columbia: the Property Transfer Tax data does not split the value by house, condo or other kind.");
  }
  const latest = readLatestDay(INFO.id);
  if (!latest) throw new SourceError("Not yet available: ProofPrice collects the BC Property Transfer Tax data daily; figures appear after the next collection.");
  const places = [...new Set(latest.rows.map((r) => r.area))].map(parseArea).filter((p): p is Place => !!p);
  const place = resolvePlace(input.town, places);
  const cands: Candidate[] = [];
  for (const r of latest.rows) {
    if (r.area !== place.key) continue;
    const m = /^residential\/(\d+)m$/.exec(r.item);
    if (m) cands.push({ months: Number(m[1]), row: r });
  }
  const asked = input.months === undefined ? 0 : Math.max(1, Math.round(input.months));
  const ans = answerFromCandidates(place, cands, latest.date, asked, input.baseUrl);
  const ageDays = Math.round((Date.now() - Date.parse(latest.date + "T00:00:00Z")) / 86400000);
  if (ageDays > 120) {
    ans.extra = { ...(ans.extra ?? {}), data_age_note: `The newest month held ends ${latest.date}, ${ageDays} days ago; BC updates its monthly files through the year, some weeks to months behind.` };
  }
  return ans;
}
