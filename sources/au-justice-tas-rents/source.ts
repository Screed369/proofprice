// Tasmania (Australia): weekly rents agreed at the start of tenancies, from the Rental Bond and Rental Data files that the
// Tasmanian Department of Justice (Consumer, Building and Occupational Services) publishes every month on data.gov.au as an
// Excel workbook. Sheet "Active Bonds" = bonds lodged in that month (new lets): suburb, postcode, bond, weekly rent, dates,
// bedrooms, dwelling type, housing type. Sheet "Closed Bonds" (old tenancies ending that month) is never used.
// The daily collector (harvest) reads the latest 12 consecutive monthly files, keeps aggregates per postcode / suburb in the
// price library, and requests are answered from there. Formats checked live on 2026-11-05 (files for May, June and August 2026).
// Folder name: it sorts before au-nsw-rents on purpose (the registry takes the first source whose serves() says yes).

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import { Cell, excelDate, readXlsx } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "au-justice-tas-rents",
  country: "AU (Tasmania)",
  category: "rent (rental bond lodgements)",
  name: "Rental Bond and Rental Data (Tasmania)",
  publisher: "Department of Justice (Tasmania), via data.gov.au",
  what_is_recorded:
    "Residential rental bonds lodged with the Tasmanian Rental Deposit Authority in the month: suburb, postcode, bond, weekly rent, number of bedrooms, dwelling type and housing type (private or community). No names or street addresses.",
  price_type: "transaction",
  freshness: "Monthly; a month's file appears about two to three weeks after the month ends",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated on the data.gov.au dataset record (Department of Justice, Tasmania)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Department of Justice (Tasmania), Rental Bond and Rental Data, via data.gov.au. Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).",
  homepage: "https://www.data.gov.au/data/dataset/rental-bond-and-rental-data-july-2026-to-june-2027",
  limits:
    "Tasmania only. Rents of newly lodged bonds, so new tenancies, not sitting tenants, as reported by the agent or landlord. Community (social) housing is left out, so these are private-market rents. Bonds of an unrecognised dwelling type count in 'any' only. Aggregates by postcode or suburb; an area with fewer than 5 bonds in the window gets no figure. Houses include townhouses, semi-detached homes and terraces.",
};

export const SEARCH_URL =
  "https://www.data.gov.au/data/api/3/action/package_search?q=rental+bond+and+rental+data&fq=organization:department-of-justice-tasmania&rows=100";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface MonthFile {
  month: string; // YYYY-MM of the lodgements
  url: string;
}

/** The monthly .xlsx files from the CKAN package_search answer, newest first. File names are abs-report-<month>-<year>.xlsx
 *  (the year has two digits in one 2024 file). Older .xls files and the 2016-2018 packages do not match and are ignored. */
export function parseMonthFiles(json: unknown): MonthFile[] {
  const packages: any[] = (json as any)?.result?.results;
  if (!Array.isArray(packages)) throw new SourceError("The data.gov.au package search for Tasmanian rental bond data returned an unexpected answer.");
  const seen = new Map<string, { url: string; modified: string }>();
  for (const p of packages) {
    for (const r of Array.isArray(p?.resources) ? p.resources : []) {
      const url = String(r?.url ?? "");
      const m = /\/abs-report-([a-z]+)-(\d{2}|\d{4})\.xlsx$/i.exec(url);
      if (!m) continue;
      const mi = MONTH_NAMES.indexOf(m[1].toLowerCase());
      if (mi < 0) continue;
      const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      const month = `${year}-${String(mi + 1).padStart(2, "0")}`;
      const modified = String(r?.last_modified ?? "");
      const old = seen.get(month);
      if (!old || modified > old.modified) seen.set(month, { url, modified });
    }
  }
  return [...seen.entries()].map(([month, v]) => ({ month, url: v.url })).sort((a, b) => b.month.localeCompare(a.month));
}

/** The files from the newest back to the first missing month: a window must not have a hole in it. */
export function consecutiveRun(files: MonthFile[]): MonthFile[] {
  const out: MonthFile[] = [];
  for (const f of files) {
    if (out.length) {
      const [y, m] = out[out.length - 1].month.split("-").map(Number);
      const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
      if (f.month !== prev) break;
    }
    out.push(f);
  }
  return out;
}

export interface Bond {
  postcode: string;
  suburb: string; // upper case
  type: "apartment" | "house" | "other"; // other = unrecognised dwelling type (counts in 'any' only)
  beds: number | null;
  rent: number; // AUD per week
  bond: number | null; // AUD, for the ratio check
}

const toNum = (c: Cell): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c === "string" && /^\s*\d+(\.\d+)?\s*$/.test(c)) return Number(c);
  return null;
};

export function dwelling(raw: string): Bond["type"] | "skip" {
  const t = raw.trim().toLowerCase();
  if (/\b(room|garage|car ?space|caravan|boarding)\b/.test(t)) return "skip";
  if (/(unit|apartment|flat)/.test(t)) return "apartment";
  if (/(house|townhouse|semi|terrace|duplex|villa)/.test(t)) return "house";
  return "other";
}

/** Bonds from the "Active Bonds" sheet of one month's workbook: find the header row by its names, keep private-housing
 *  bonds lodged in `month` (YYYY-MM) with a plausible weekly rent (50..5000) and at most 6 bedrooms. */
export function parseBonds(rows: Cell[][], month: string): Bond[] {
  const lower = (c: Cell) => String(c ?? "").trim().toLowerCase();
  const hi = rows.findIndex((r) => r.some((c) => lower(c) === "postcode") && r.some((c) => lower(c) === "weekly rent"));
  if (hi < 0) throw new SourceError("The Tasmanian rental bond file has a new layout (no Postcode / Weekly Rent header); this source needs updating.");
  const head = rows[hi].map(lower);
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const cSub = col("suburb");
  const cPost = col("postcode");
  const cBond = col("bond amount");
  const cRent = col("weekly rent");
  const cDate = col("bond lodgement date");
  const cBeds = col("number of bedrooms");
  const cType = col("dwelling");
  const cHous = col("housing type");
  if (cDate < 0 || cBeds < 0 || cType < 0 || cHous < 0) throw new SourceError("The Tasmanian rental bond file has a new layout (a Lodgement date / Bedrooms / Dwelling / Housing Type column is missing); this source needs updating.");
  const out: Bond[] = [];
  for (const r of rows.slice(hi + 1)) {
    const rent = toNum(r[cRent]);
    const pc = String(r[cPost] ?? "").trim();
    if (rent === null || rent < 50 || rent > 5000 || !/^7\d{3}$/.test(pc)) continue;
    if (!/private/i.test(String(r[cHous] ?? ""))) continue; // community (social) housing is not market rent
    const d = excelDate(r[cDate]);
    if (!d || d.slice(0, 7) !== month) continue; // strays from other months
    const type = dwelling(String(r[cType] ?? ""));
    if (type === "skip") continue;
    const beds = toNum(r[cBeds]);
    if (beds !== null && beds > 6) continue; // stray 9 and 23 bedrooms in the real file
    const bond = toNum(r[cBond]);
    out.push({
      postcode: pc,
      suburb: String(r[cSub] ?? "").trim().toUpperCase(),
      type,
      beds: beds !== null && beds >= 0 && Number.isInteger(beds) ? beds : null,
      rent,
      bond: bond !== null && bond > 0 ? bond : null,
    });
  }
  return out;
}

/** Outside check (Rule Q1): the bond is a separately recorded amount and the Residential Tenancy Act caps it at 4 weeks' rent,
 *  so the median bond / weekly rent ratio of a month's file must sit at 4. Returns the median ratio (null if no bonds). */
export function medianBondWeeks(bonds: Bond[]): number | null {
  const r = bonds.filter((b) => b.bond !== null).map((b) => b.bond! / b.rent).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : null;
}

export const TAS_WINDOWS = [3, 12] as const;
export type TasType = "any" | "apartment" | "house";
export const TAS_TYPES: TasType[] = ["any", "apartment", "house"];

/** "<type>:<bedrooms>:<months>m", bedrooms "any", "0".."4" (4 = four or more). */
export function tasItem(type: TasType, beds: string, months: number): string {
  return `${type}:${beds}:${months}m`;
}

export function typesOf(b: Bond): TasType[] {
  return b.type === "other" ? ["any"] : ["any", b.type];
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** First day of the month `n - 1` months before `month`. */
export function windowStart(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - n, 1)).toISOString().slice(0, 10);
}

/** Library rows for a set of months (newest first). Areas: postcode, upper-case suburb, and ALL (the whole state). */
export function tasDailyRows(months: { month: string; bonds: Bond[] }[]): { date: string; rows: DailyRow[] } {
  if (months.length < TAS_WINDOWS[0]) throw new SourceError(`Only ${months.length} monthly Tasmanian file(s) could be read; at least ${TAS_WINDOWS[0]} are needed.`);
  const recs: { area: string; item: string; price: number }[] = [];
  const subs: { area: string; item: string; price: number }[] = []; // suburbs must not feed the state row a second time
  months.forEach((m, i) => {
    for (const b of m.bonds) {
      const bedKeys = b.beds === null ? ["any"] : ["any", String(Math.min(b.beds, 4))];
      for (const w of TAS_WINDOWS) {
        if (i >= w || months.length < w) continue;
        for (const t of typesOf(b)) {
          for (const bk of bedKeys) {
            const item = tasItem(t, bk, w);
            recs.push({ area: b.postcode, item, price: b.rent });
            if (b.suburb && b.suburb !== b.postcode) subs.push({ area: b.suburb, item, price: b.rent });
          }
        }
      }
    }
  });
  return { date: monthEnd(months[0].month), rows: [...aggregateDaily(recs, true), ...aggregateDaily(subs, false)] };
}

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

async function download(url: string, tries = 3): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The daily collector: read the latest 12 consecutive monthly files once and return aggregates per area and window. */
export async function tasHarvest(): Promise<HarvestResult> {
  const listing = JSON.parse((await download(SEARCH_URL)).toString("utf8"));
  const files = consecutiveRun(parseMonthFiles(listing)).slice(0, 12);
  if (!files.length) throw new SourceError("No monthly Tasmanian rental bond files found on data.gov.au; the catalogue may have changed.");
  const months: { month: string; bonds: Bond[] }[] = [];
  for (const f of files) {
    try {
      const sheets = readXlsx(await download(f.url));
      const sheet = sheets.find((s) => /active/i.test(s.name)) ?? sheets[0];
      if (!sheet) throw new SourceError("no sheet in the workbook");
      const bonds = parseBonds(sheet.rows, f.month);
      const weeks = medianBondWeeks(bonds);
      if (weeks === null || weeks < 3.5 || weeks > 4.5) throw new SourceError(`Tasmanian ${f.month} file fails the bond check (median bond is ${weeks?.toFixed(2)} weeks of rent, expected 4); rents may be in the wrong column.`);
      months.push({ month: f.month, bonds });
    } catch (e: any) {
      if (months.length === 0) throw e; // the newest month must work
      break; // an older month failed: keep the shorter windows that are complete
    }
  }
  const { date, rows } = tasDailyRows(months);
  const windows = TAS_WINDOWS.filter((w) => months.length >= w).join("/");
  return {
    date,
    currency: "AUD",
    unit: "per week",
    rows,
    note: `Windows of ${windows} months ending ${date}; weekly rent of newly lodged private rental bonds in Tasmania, by postcode and suburb.`,
  };
}

// ---------- answering ----------

export interface TasInput {
  postcode?: string;
  town?: string;
  property_type?: string;
  bedrooms?: number;
  months?: number;
  baseUrl?: string;
}

const TITLE = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

export function tasArea(input: { postcode?: string; town?: string }): { area: string; label: string } {
  const t = input.town?.trim();
  const pc = input.postcode?.trim() ?? (t && /^\d{4}$/.test(t) ? t : undefined);
  if (pc) {
    if (!/^7\d{3}$/.test(pc)) throw new InputError("A Tasmanian postcode has four digits and starts with 7, e.g. 7000 (Hobart) or 7250 (Launceston).");
    return { area: pc, label: `postcode ${pc}` };
  }
  const low = t?.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  if (low && ["tas", "tasmania", "all", "all tas", "all tasmania"].includes(low)) return { area: NATIONAL, label: "Tasmania" };
  if (low && low.length > 1) return { area: low.toUpperCase(), label: TITLE(low) };
  throw new InputError("Tasmanian rents are published by postcode or suburb: give a postcode (for example 7000 for Hobart) or a suburb or town (for example Launceston). Use town=Tasmania for the whole state.");
}

export function tasType(pt?: string): { type: TasType; label: string } {
  if (pt === undefined || pt === "any") return { type: "any", label: "homes" };
  if (pt === "apartment") return { type: "apartment", label: "units and apartments" };
  if (pt === "house") return { type: "house", label: "houses, townhouses and semi-detached homes" };
  if (pt === "room") throw new InputError("Tasmanian rental bond data does not identify rented rooms, so property_type room is not available.");
  throw new InputError('property_type must be "apartment", "house" or "any".');
}

export function tasBeds(b?: number): { key: string; label: string } {
  if (b === undefined) return { key: "any", label: "" };
  if (b < 0 || !Number.isInteger(b)) throw new InputError("bedrooms must be a whole number from 0 (studio) to 4 or more.");
  const key = String(Math.min(b, 4));
  return { key, label: b === 0 ? "studio or no-bedroom " : b >= 4 ? "4+ bedroom " : `${b}-bedroom ` };
}

/** Pure: the library key for /history (3-month window, one point per month). */
export function tasHistoryKey(input: { postcode?: string; town?: string; property_type?: string; bedrooms?: number }): { area: string; item: string; label: string } {
  const a = tasArea(input);
  const t = tasType(input.property_type);
  const b = tasBeds(input.bedrooms);
  return { area: a.area, item: tasItem(t.type, b.key, 3), label: `${b.label}${t.label} in ${a.label}, Tasmania (3-month window)` };
}

/** Pure: the answer for one library row (or null). */
export function tasAnswerFromRow(
  row: (DailyRow & { date: string }) | null,
  q: { area: string; areaLabel: string; typeLabel: string; bedLabel: string; type: TasType; bedKey: string; window: number; triedWindows: number[]; baseUrl?: string },
): PriceAnswer {
  const latestMonth = row ? row.date.slice(0, 7) : null;
  const query = {
    country: "AU",
    state: "TAS",
    ...(q.area === NATIONAL ? { town: "Tasmania" } : /^\d{4}$/.test(q.area) ? { postcode: q.area } : { town: q.areaLabel }),
    property_type: q.type,
    bedrooms: q.bedKey === "any" ? null : q.bedKey === "4" ? "4 or more" : Number(q.bedKey),
    months: q.window,
  };
  const monthly = (w: number) => Math.round((w * 52) / 12);
  return buildAnswer({
    source: INFO,
    query,
    summary: row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null,
    currency: "AUD",
    unit: "per week",
    period: latestMonth ? { from: windowStart(latestMonth, q.window), to: row!.date } : { from: null, to: null },
    method:
      `Median and 10th–90th percentile of the weekly rent agreed on private rental bonds lodged in Tasmania over the last ${q.window} months ` +
      "(the latest published months), for the chosen postcode or suburb, dwelling type and bedrooms. Community housing is left out. Rents are as reported by the agent or landlord when the bond is lodged, so they describe new tenancies.",
    describe: (x) =>
      `Rental bonds lodged for new private tenancies of ${q.bedLabel}${q.typeLabel} in ${q.areaLabel}, Tasmania show a median agreed weekly rent of ${fmtMoney(x.median, "AUD")} (about ${fmtMoney(monthly(x.median), "AUD")} a month); typical range (10th–90th percentile) ${fmtMoney(x.low, "AUD")}–${fmtMoney(x.high, "AUD")} a week. ` +
      "These are rents of new leases as reported by the agent or landlord, not what sitting tenants pay.",
    baseUrl: q.baseUrl,
    extra: {
      ...(row ? { median_per_month_equivalent: monthly(row.median), per_month_note: "Weekly rent x 52 / 12; the published figures are weekly." } : {}),
      window_months: q.window,
      windows_tried: q.triedWindows,
    },
  });
}

export async function tasRents(input: TasInput): Promise<PriceAnswer> {
  const a = tasArea(input);
  const t = tasType(input.property_type);
  const b = tasBeds(input.bedrooms);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects Tasmanian rental bond data daily; figures appear after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 45 * 86400000).toISOString().slice(0, 10);
  const order: number[] = input.months === undefined ? [3, 12] : input.months <= 4 ? [3] : [12];
  let row: (DailyRow & { date: string }) | null = null;
  let used = order[order.length - 1];
  for (const w of order) {
    const rows = readDaily(INFO.id, { area: a.area, item: tasItem(t.type, b.key, w), from, to });
    const r = rows[rows.length - 1];
    if (r && r.n >= MIN_PUBLISH) {
      row = r;
      used = w;
      break;
    }
  }
  const ans = tasAnswerFromRow(row, { area: a.area, areaLabel: a.label, typeLabel: t.label, bedLabel: b.label, type: t.type, bedKey: b.key, window: used, triedWindows: order, baseUrl: input.baseUrl });
  const ageDays = Math.round((Date.now() - Date.parse(to + "T00:00:00Z")) / 86400000);
  if (ageDays > 90) {
    ans.extra = { ...(ans.extra ?? {}), data_age_note: `The newest lodgements held are for the month ending ${to}, ${ageDays} days ago; Tasmania normally publishes a month within three weeks of its end.` };
  }
  return ans;
}
