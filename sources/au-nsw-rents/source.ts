// New South Wales (Australia): weekly rents agreed at the start of tenancies, from the rental bond lodgements that
// NSW Fair Trading publishes every month as an Excel file (one row per bond: date, postcode, dwelling type, bedrooms,
// weekly rent). The files are too big to read per request, so the daily collector (harvest) reads the latest 12 monthly
// files once, keeps only aggregates per postcode in the price library, and requests are answered from there.
// Formats checked live on 2026-10-14 (the September 2026 file: 26 615 rows, sheet "Sept26 Rental Bond Lodgments" plus "Definitions").

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import { Cell, readXlsx } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "au-nsw-rents",
  country: "AU (New South Wales)",
  category: "rent (rental bond lodgements)",
  name: "Rental bond lodgement data",
  publisher: "NSW Fair Trading, NSW Government (Australia)",
  what_is_recorded:
    "Residential rental bonds lodged at the start of a tenancy: lodgement date, postcode, dwelling type, number of bedrooms and the weekly rent, as provided by the agent or landlord.",
  price_type: "transaction",
  freshness: "Monthly; a month's lodgements are published in the first days of the next month",
  licence: "Creative Commons Attribution (CC BY), as stated on the NSW Government open data portal for the Rental Bond Lodgement dataset",
  licence_url: "https://data.nsw.gov.au/data/dataset/rental-bond-lodgement",
  attribution: "Source: NSW Fair Trading (NSW Government), Rental bond lodgement data. Licensed under Creative Commons Attribution (CC BY).",
  homepage: "https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data",
  limits:
    "New South Wales only (not the rest of Australia). Rents of newly lodged bonds, so new tenancies, not sitting tenants. Rents are as provided by the agent or landlord. 'Other' dwellings (rented rooms, garages and car spaces) and unknown types are in 'any' only. Aggregates by postcode; a postcode with fewer than 5 bonds in the window gets no figure. Houses include terraces, townhouses and semi-detached homes.",
};

export const PAGE_URL = "https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data";
const SITE = "https://www.nsw.gov.au";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface MonthFile {
  month: string; // YYYY-MM of the lodgements
  url: string;
}

/** The monthly lodgement files listed on the NSW page, newest first. Annual, refund and holdings files are left out. */
export function parseLodgementLinks(html: string): MonthFile[] {
  const seen = new Map<string, string>();
  // The visible link text is consistent ("Rental bond lodgement data - March 2026 (XLSX 745.2KB)"); the title attribute is not
  // (some say "Retail lodgement data - April 2024" or "Rental bond lodgements August 2025"), so only the text is used.
  const label = /^Rental bond lodgements? data\s*-\s*([A-Za-z]+)\s+(\d{4})\b/i;
  for (const m of html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = /\shref="([^"]+)"/.exec(" " + m[1])?.[1];
    if (!href || !/\.xlsx(\?|$)/i.test(href)) continue;
    const text = m[2].replace(/<[^>]*>/g, "").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").trim();
    const t = label.exec(text);
    if (!t) continue;
    const mi = MONTH_NAMES.indexOf(t[1].toLowerCase());
    if (mi < 0) continue;
    const month = `${t[2]}-${String(mi + 1).padStart(2, "0")}`;
    if (!seen.has(month)) seen.set(month, href.startsWith("http") ? href : SITE + href);
  }
  return [...seen.entries()].map(([month, url]) => ({ month, url })).sort((a, b) => b.month.localeCompare(a.month));
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
  type: string; // F flat/unit, H house, T terrace/townhouse/semi-detached, O other, U unknown
  beds: number | null;
  rent: number; // AUD per week
}

const num = (c: Cell): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c === "string" && /^\s*\d+(\.\d+)?\s*$/.test(c)) return Number(c);
  return null; // "U" (unknown) and blanks
};

/** Bonds from the monthly sheet: find the header row by its column names, then read the rows under it. */
export function parseBonds(rows: Cell[][]): Bond[] {
  const lower = (c: Cell) => String(c ?? "").trim().toLowerCase();
  const hi = rows.findIndex((r) => r.some((c) => lower(c) === "postcode") && r.some((c) => lower(c).includes("rent")));
  if (hi < 0) throw new SourceError("The NSW rental bond file has a new layout (no Postcode / Weekly Rent header); this source needs updating.");
  const head = rows[hi].map(lower);
  const col = (name: string) => head.findIndex((h) => h === name || h.startsWith(name));
  const cPost = col("postcode");
  const cType = col("dwelling");
  const cBeds = col("bedroom");
  const cRent = head.findIndex((h) => h.includes("rent"));
  if (cType < 0 || cBeds < 0) throw new SourceError("The NSW rental bond file has a new layout (no Dwelling Type / Bedrooms column); this source needs updating.");
  const out: Bond[] = [];
  for (const r of rows.slice(hi + 1)) {
    const pc = num(r[cPost]);
    const rent = num(r[cRent]);
    if (pc === null || rent === null || !Number.isInteger(pc) || pc < 1000 || pc > 9999 || rent < 50 || rent > 10000) continue;
    const beds = num(r[cBeds]);
    out.push({
      postcode: String(pc),
      type: String(r[cType] ?? "U").trim().toUpperCase().slice(0, 1) || "U",
      beds: beds !== null && beds >= 0 && beds <= 10 && Number.isInteger(beds) ? beds : null,
      rent,
    });
  }
  return out;
}

export const NSW_WINDOWS = [3, 12] as const;
export type NswType = "any" | "apartment" | "house";
export const NSW_TYPES: NswType[] = ["any", "apartment", "house"];

/** "<type>:<bedrooms>:<months>m", bedrooms "any", "0".."4" (4 = four or more). */
export function nswItem(type: NswType, beds: string, months: number): string {
  return `${type}:${beds}:${months}m`;
}

function typesOf(b: Bond): NswType[] {
  if (b.type === "F") return ["any", "apartment"];
  if (b.type === "H" || b.type === "T") return ["any", "house"];
  return ["any"];
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** First day of the month `n - 1` months before `month` (so a window of n months ending at `month` starts here). */
export function windowStart(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - n, 1)).toISOString().slice(0, 10);
}

/** Library rows for a set of months (newest first). A window is only written when that many months were read. */
export function nswDailyRows(months: { month: string; bonds: Bond[] }[]): { date: string; rows: DailyRow[] } {
  if (months.length < NSW_WINDOWS[0]) throw new SourceError(`Only ${months.length} monthly NSW file(s) could be read; at least ${NSW_WINDOWS[0]} are needed.`);
  const recs: { area: string; item: string; price: number }[] = [];
  months.forEach((m, i) => {
    for (const b of m.bonds) {
      const bedKeys = b.beds === null ? ["any"] : ["any", String(Math.min(b.beds, 4))];
      for (const w of NSW_WINDOWS) {
        if (i >= w || months.length < w) continue;
        for (const t of typesOf(b)) for (const bk of bedKeys) recs.push({ area: b.postcode, item: nswItem(t, bk, w), price: b.rent });
      }
    }
  });
  return { date: monthEnd(months[0].month), rows: aggregateDaily(recs, true) };
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

/** The daily collector: read the latest 12 monthly files once and return aggregates per postcode and window. */
export async function nswHarvest(): Promise<HarvestResult> {
  const page = await download(PAGE_URL);
  const files = consecutiveRun(parseLodgementLinks(page.toString("utf8"))).slice(0, 12);
  if (!files.length) throw new SourceError("No monthly rental bond lodgement files found on the NSW page; it may have changed.");
  const months: { month: string; bonds: Bond[] }[] = [];
  for (const f of files) {
    try {
      const sheets = readXlsx(await download(f.url));
      const sheet = sheets.find((s) => s.rows.some((r) => r.some((c) => String(c ?? "").trim().toLowerCase() === "postcode")));
      if (!sheet) throw new SourceError("no sheet with a Postcode column");
      months.push({ month: f.month, bonds: parseBonds(sheet.rows) });
    } catch (e: any) {
      if (months.length === 0) throw e; // the newest month must work
      break; // an older month failed: keep the shorter windows that are complete
    }
  }
  const { date, rows } = nswDailyRows(months);
  const windows = NSW_WINDOWS.filter((w) => months.length >= w).join("/");
  return {
    date,
    currency: "AUD",
    unit: "per week",
    rows,
    note: `Windows of ${windows} months ending ${date}; weekly rent of newly lodged rental bonds in NSW, by postcode.`,
  };
}

// ---------- answering ----------

export interface NswInput {
  postcode?: string;
  town?: string;
  property_type?: string;
  bedrooms?: number;
  months?: number;
  baseUrl?: string;
}

export function nswArea(input: { postcode?: string; town?: string }): { area: string; label: string } {
  const pc = input.postcode?.trim() ?? (input.town && /^\d{4}$/.test(input.town.trim()) ? input.town.trim() : undefined);
  if (pc) {
    if (!/^\d{4}$/.test(pc)) throw new InputError("An NSW postcode has four digits, e.g. 2000.");
    return { area: pc, label: `postcode ${pc}` };
  }
  const t = input.town?.trim().toLowerCase().replace(/[.,]/g, "");
  if (t && ["nsw", "new south wales", "all", "all nsw"].includes(t)) return { area: NATIONAL, label: "New South Wales" };
  throw new InputError(
    `NSW rents are published by postcode, so a postcode is required (for example 2000 for Sydney CBD${input.town ? `; '${input.town}' is not a postcode` : ""}). Use town=NSW for the whole state.`,
  );
}

export function nswType(pt?: string): { type: NswType; label: string } {
  if (pt === undefined || pt === "any") return { type: "any", label: "homes" };
  if (pt === "apartment") return { type: "apartment", label: "flats and units" };
  if (pt === "house") return { type: "house", label: "houses, terraces and townhouses" };
  if (pt === "room") throw new InputError("NSW rental bond data does not identify rented rooms separately, so property_type room is not available.");
  throw new InputError('property_type must be "apartment", "house" or "any".');
}

export function nswBeds(b?: number): { key: string; label: string } {
  if (b === undefined) return { key: "any", label: "" };
  if (b < 0 || !Number.isInteger(b)) throw new InputError("bedrooms must be a whole number from 0 (studio) to 4 or more.");
  const key = String(Math.min(b, 4));
  return { key, label: b === 0 ? "studio or no-bedroom " : b >= 4 ? "4+ bedroom " : `${b}-bedroom ` };
}

/** Pure: the answer for one library row (or null). */
export function nswAnswerFromRow(
  row: (DailyRow & { date: string }) | null,
  q: { area: string; areaLabel: string; typeLabel: string; bedLabel: string; type: NswType; bedKey: string; window: number; triedWindows: number[]; baseUrl?: string },
): PriceAnswer {
  const latestMonth = row ? row.date.slice(0, 7) : null;
  const query = {
    country: "AU",
    state: "NSW",
    ...(q.area === NATIONAL ? { town: "New South Wales" } : { postcode: q.area }),
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
      `Median and 10th–90th percentile of the weekly rent agreed on rental bonds lodged in NSW over the last ${q.window} months ` +
      "(the latest published months), for the chosen postcode, dwelling type and bedrooms. Rents are as provided by the agent or landlord when the bond is lodged, so they describe new tenancies.",
    describe: (x) =>
      `Rental bonds lodged for ${q.bedLabel}${q.typeLabel} in ${q.areaLabel}, NSW show a median weekly rent of ${fmtMoney(x.median, "AUD")} (about ${fmtMoney(monthly(x.median), "AUD")} a month); typical range ${fmtMoney(x.low, "AUD")}–${fmtMoney(x.high, "AUD")} a week.`,
    baseUrl: q.baseUrl,
    extra: {
      ...(row ? { median_per_month_equivalent: monthly(row.median), per_month_note: "Weekly rent x 52 / 12; the published figures are weekly." } : {}),
      window_months: q.window,
      windows_tried: q.triedWindows,
    },
  });
}

export async function nswRents(input: NswInput): Promise<PriceAnswer> {
  const a = nswArea(input);
  const t = nswType(input.property_type);
  const b = nswBeds(input.bedrooms);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects NSW rental bond data daily; figures appear after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 45 * 86400000).toISOString().slice(0, 10);
  // Default: the latest 3 months, falling back to 12 when a postcode is too quiet. months <= 4 asks for 3, anything longer for 12.
  const order: number[] = input.months === undefined ? [3, 12] : input.months <= 4 ? [3] : [12];
  let row: (DailyRow & { date: string }) | null = null;
  let used = order[order.length - 1];
  for (const w of order) {
    const rows = readDaily(INFO.id, { area: a.area, item: nswItem(t.type, b.key, w), from, to });
    const r = rows[rows.length - 1];
    if (r && r.n >= MIN_PUBLISH) {
      row = r;
      used = w;
      break;
    }
  }
  const ans = nswAnswerFromRow(row, { area: a.area, areaLabel: a.label, typeLabel: t.label, bedLabel: b.label, type: t.type, bedKey: b.key, window: used, triedWindows: order, baseUrl: input.baseUrl });
  const ageDays = Math.round((Date.now() - Date.parse(to + "T00:00:00Z")) / 86400000);
  if (ageDays > 75) {
    ans.extra = { ...(ans.extra ?? {}), data_age_note: `The newest lodgements held are for the month ending ${to}, ${ageDays} days ago; NSW normally publishes a month within a week of its end.` };
  }
  return ans;
}

