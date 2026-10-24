// South Australia: median weekly rent of NEW tenancies by suburb and postcode, from the rental bonds lodged with Consumer and Business
// Services (SA Housing Authority "Private Rent Report", quarterly Excel workbook on data.sa.gov.au, licence CC BY 4.0).
// Each quarter the publisher posts a new workbook (resource "Private Rental Report YYYY-MM", e.g. 2026-06 = April-June 2026) with sheets
// Suburb, PC (postcode), Region and SLA. Per row: the number of bonds lodged and the published MEDIAN weekly rent for flats/units and houses
// by number of bedrooms, plus totals. Medians cannot be merged, so each answer is one published cell; we pass it on.
// Format read on 2026-10-24 (GitHub Actions run of the 2026-06 workbook, 251 736 bytes): header block of notes in rows 1-12, title in row 14
// ("... median weekly rental, 1 April - 30 June 2026, South Australia"), group labels in rows 15-16, "Row Labels | Count | Median ..." in row 17,
// section rows "Metro" / "Rest of State", then one row per suburb or postcode; counts of 1 to 5 are replaced by "*" and flat/house totals are rounded to 5.
// The daily collector (harvest) reads the newest workbook once and keeps the latest quarter in the price library; requests are answered from there.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parsePackageShow } from "../../lib/adapters/ckan";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import { Cell, readXlsx } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "au-adelaide-sa-rents",
  country: "AU (South Australia)",
  category: "rent (median rent of new tenancies from rental bonds)",
  name: "Private Rent Report: median weekly rents of new tenancies by suburb and postcode",
  publisher: "SA Housing Authority (South Australian Housing Trust), Government of South Australia (Australia)",
  what_is_recorded:
    "For each South Australian suburb and postcode each quarter: the number of rental bonds lodged with Consumer and Business Services and the median weekly rent, for flats/units and houses by number of bedrooms and in total. Aggregates only; never one tenancy or one address.",
  price_type: "official_statistic",
  freshness: "Quarterly; a quarter's report is posted about six weeks after it ends (April-June 2026 was posted on 11 Aug 2026)",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), the licence set on the Private Rent Report dataset page of the SA open data portal",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: SA Housing Authority, Government of South Australia, Private Rent Report (data.sa.gov.au), licensed under Creative Commons Attribution 4.0 (CC BY 4.0). Figures passed on as published; the monthly equivalent is calculated by ProofPrice.",
  homepage: "https://data.sa.gov.au/data/dataset/private-rent-report",
  limits:
    "South Australia only (not the rest of Australia), by suburb or postcode. Rents of NEW tenancies whose bond was lodged in the quarter, not what sitting tenants pay. The publisher gives one median per dwelling type and bedroom count (4 means four or more), so medians cannot be combined; no range is published. Counts of 1 to 5 bonds are withheld by the publisher and flat/house totals are rounded to the nearest 5; a figure is shown only with at least 6 bonds (at least 10 for the rounded totals). The all-homes total also includes other dwellings and rooms.",
};

export const PACKAGE_URL = "https://data.sa.gov.au/data/api/3/action/package_show?id=private-rent-report";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** Items stored in the library: flat/house by bedrooms (4 = 4+), the flat and house totals, and the all-dwellings total. */
export type SaKind = "flat" | "house";
export const SA_ITEMS: { item: string; kind: SaKind | "all"; beds: number | null; countCol: number; rounded: boolean }[] = [
  { item: "flat-1", kind: "flat", beds: 1, countCol: 1, rounded: false },
  { item: "flat-2", kind: "flat", beds: 2, countCol: 3, rounded: false },
  { item: "flat-3", kind: "flat", beds: 3, countCol: 5, rounded: false },
  { item: "flat-4", kind: "flat", beds: 4, countCol: 7, rounded: false },
  { item: "flat", kind: "flat", beds: null, countCol: 9, rounded: true },
  { item: "house-1", kind: "house", beds: 1, countCol: 11, rounded: false },
  { item: "house-2", kind: "house", beds: 2, countCol: 13, rounded: false },
  { item: "house-3", kind: "house", beds: 3, countCol: 15, rounded: false },
  { item: "house-4", kind: "house", beds: 4, countCol: 17, rounded: false },
  { item: "house", kind: "house", beds: null, countCol: 19, rounded: true },
  { item: "all", kind: "all", beds: null, countCol: 25, rounded: true },
];
const MIN_EXACT = 6; // counts of 1 to 5 are shown as "*"
const MIN_ROUNDED = 10; // totals are rounded to the nearest 5, so a printed 5 may stand for 3

// ---------- parsing the workbook (pure) ----------

const text = (c: Cell) => String(c ?? "").trim();
const num = (c: Cell): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = text(c);
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; // "*" and blanks are not numbers
};

const MONTH_NUM: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** "... 1 April - 30 June 2026 ..." in the sheet's title row -> the last day of the quarter, YYYY-MM-DD. */
export function quarterEnd(rows: Cell[][]): string {
  for (const r of rows.slice(0, 20)) {
    for (const c of r) {
      const m = /(\d{1,2})\s+([A-Za-z]+)\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text(c));
      if (!m) continue;
      const mon = MONTH_NUM[m[4].toLowerCase()];
      const day = Number(m[3]);
      if (mon && day >= 28) return `${m[5]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  throw new SourceError("The SA Private Rent Report workbook has a new layout (no 'dd Month - dd Month yyyy' period in the title); this source needs updating.");
}

export const suburbKey = (name: string) => "s:" + name.toLowerCase().replace(/\s+/g, " ").trim();

export interface SaSheet {
  date: string;
  rows: DailyRow[];
}

/** Read the "Suburb" or "PC" sheet into library rows (area = postcode, or "s:<suburb>"). */
export function parseSheet(rows: Cell[][], kind: "suburb" | "postcode"): SaSheet {
  const date = quarterEnd(rows);
  const hi = rows.findIndex((r) => text(r[0]).toLowerCase() === "row labels");
  if (hi < 2) throw new SourceError("The SA Private Rent Report workbook has a new layout (no 'Row Labels' header); this source needs updating.");
  const g = rows[hi - 2] ?? [];
  const ok = text(g[1]).startsWith("Flats") && text(g[11]).startsWith("Houses") && text(g[25]).startsWith("Total Count") && text(g[26]).startsWith("Total Median");
  if (!ok) throw new SourceError("The SA Private Rent Report workbook has a new layout (the Flats/Houses/Total columns moved); this source needs updating.");
  const out: DailyRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const label = text(r[0]);
    if (!label || /total$/i.test(label)) continue;
    let area: string;
    if (kind === "postcode") {
      if (!/^\d{4}$/.test(label)) continue;
      area = label;
    } else {
      if (/^(metro|rest of state)$/i.test(label) || /^\d+$/.test(label)) continue;
      area = suburbKey(label);
    }
    for (const it of SA_ITEMS) {
      const n = num(r[it.countCol]);
      const med = num(r[it.countCol + 1]);
      if (n === null || med === null || n < (it.rounded ? MIN_ROUNDED : MIN_EXACT) || n < MIN_PUBLISH) continue;
      if (med < 50 || med > 10000) continue;
      out.push({ area, item: it.item, n, median: med, low: med, high: med, min: med, max: med });
    }
  }
  out.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date, rows: out };
}

export function findSheet(sheets: { name: string; rows: Cell[][] }[], name: string): Cell[][] {
  const s = sheets.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new SourceError(`The SA Private Rent Report workbook has a new layout (no '${name}' sheet); this source needs updating.`);
  return s.rows;
}

/** The newest "Private Rental Report YYYY-MM" workbook among a dataset's files. */
export function newestWorkbook(json: unknown): { url: string; name: string } {
  const pkg = parsePackageShow(json);
  let best: { url: string; name: string; key: string } | null = null;
  for (const r of pkg.resources) {
    const m = /Private Rental Report\s+(\d{4})-(\d{2})/i.exec(r.name);
    if (!m || r.format !== "XLSX" || !/^https:\/\//.test(r.url)) continue;
    const key = `${m[1]}-${m[2]}`;
    if (!best || key > best.key) best = { url: r.url, name: r.name, key };
  }
  if (!best) throw new SourceError("The SA Private Rent Report dataset lists no 'Private Rental Report YYYY-MM' Excel file; this source needs updating.");
  return best;
}

// ---------- collector ----------

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

async function download(url: string, tries = 3): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The daily collector: find the newest workbook, read it once, return the newest quarter's suburb and postcode medians. */
export async function saHarvest(): Promise<HarvestResult> {
  const listing = JSON.parse((await download(PACKAGE_URL)).toString("utf8"));
  const wb = newestWorkbook(listing);
  const sheets = readXlsx(await download(wb.url));
  const sub = parseSheet(findSheet(sheets, "Suburb"), "suburb");
  const pc = parseSheet(findSheet(sheets, "PC"), "postcode");
  if (sub.date !== pc.date) throw new SourceError(`The Suburb and PC sheets end in different quarters (${sub.date} and ${pc.date}); this source needs updating.`);
  const rows = [...pc.rows, ...sub.rows];
  if (!rows.length) throw new SourceError("The SA Private Rent Report gave no suburb or postcode with enough bonds; it may have changed.");
  return {
    date: sub.date,
    currency: "AUD",
    unit: "per week",
    rows,
    note: `Median weekly rent of new tenancies in the quarter ending ${sub.date}, by South Australian suburb and postcode and dwelling type; n is the number of bonds lodged (${wb.name}).`,
  };
}

// ---------- answering ----------

export interface SaInput {
  postcode?: string;
  town?: string;
  property_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

/** The library area for a request: a 5xxx postcode, or a suburb name. */
export function saArea(input: { postcode?: string; town?: string }): { area: string; label: string } {
  const pc = input.postcode?.trim() || (input.town && /^\d{4}$/.test(input.town.trim()) ? input.town.trim() : undefined);
  if (pc) {
    if (!/^\d{4}$/.test(pc)) throw new InputError("A South Australian postcode has four digits, e.g. 5000 (Adelaide).");
    return { area: pc, label: `postcode ${pc}` };
  }
  const town = input.town?.trim();
  if (town && !/^(sa|south australia)$/i.test(town)) return { area: suburbKey(town), label: town };
  throw new InputError("South Australian rents are published by suburb and postcode, so give a suburb (town, e.g. Glenelg) or a postcode (e.g. 5000 for Adelaide, 5067 for Norwood).");
}

export function saWants(pt?: string, beds?: number): string[] {
  if (pt === "room") throw new InputError("The Private Rent Report does not cover rented rooms, so property_type room is not available.");
  if (pt !== undefined && !["any", "apartment", "flat", "house"].includes(pt)) throw new InputError('property_type must be "apartment" (flat), "house" or "any".');
  if (beds !== undefined && (!Number.isInteger(beds) || beds < 0)) throw new InputError("bedrooms must be a whole number.");
  const b = beds === undefined ? undefined : Math.min(beds, 4);
  if (b === 0) return []; // studios are not published
  const kinds = pt === "apartment" || pt === "flat" ? ["flat"] : pt === "house" ? ["house"] : ["flat", "house"];
  if (b === undefined) return pt === undefined || pt === "any" ? ["all"] : kinds;
  return kinds.map((k) => `${k}-${b}`);
}

const quarterLabel = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
};
const quarterStart = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
};
const monthly = (w: number) => Math.round((w * 52) / 12);

export function itemText(item: string): string {
  if (item === "all") return "homes of all kinds (flats, houses and other dwellings)";
  const [k, b] = item.split("-");
  const kind = k === "flat" ? "flats and units" : "houses";
  return b ? `${b === "4" ? "4+ bedroom" : `${b}-bedroom`} ${kind}` : `${kind} of all sizes`;
}

const METHOD =
  "The SA Housing Authority publishes every quarter, from the rental bonds lodged with Consumer and Business Services, the number of bonds and the median weekly rent of new private tenancies per suburb and postcode, for flats/units and houses by number of bedrooms and in total. " +
  "ProofPrice passes on the published median for the latest quarter and uses the number of bonds as the sample size. The publisher withholds counts of 1 to 5 and rounds flat and house totals to the nearest 5, so a figure needs at least 6 bonds (10 for the rounded totals). " +
  "Medians of different dwelling types cannot be combined, so each answer is one published cell; with no type and no size the all-homes total. No range is published.";

export interface Cand {
  item: string;
  row: DailyRow & { date: string };
}

/** Pure: the answer from the candidate library rows (already filtered to what was asked). */
export function saAnswerFromCandidates(cands: Cand[], q: { area: string; label: string; baseUrl?: string }): PriceAnswer {
  const sorted = [...cands].sort((a, b) => b.row.n - a.row.n || a.item.localeCompare(b.item));
  const top = sorted[0];
  const query = { country: "AU", state: "SA", place: q.label };
  if (!top) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "median", currency: "AUD", unit: "per week",
      period: { from: null, to: null }, reference_period: "", method: METHOD, describe: () => "", baseUrl: q.baseUrl,
      extra: { hint: `No figure for ${q.label}: it is not a South Australian suburb or postcode in the Private Rent Report, or too few bonds were lodged for that kind of home in the latest quarter. Try another dwelling type, a nearby suburb, or leave the type and bedrooms out.` },
    });
  }
  const d = top.row.date;
  const others = sorted.slice(1).map((c) => ({ dwelling: itemText(c.item), median_weekly_rent: c.row.median, bonds_lodged: c.row.n }));
  const pick = sorted.length > 1 ? ` This is the kind with most bonds (${top.row.n}); the other is listed under extra.other_dwellings.` : "";
  return buildStatisticAnswer({
    source: INFO,
    query: { ...query, dwelling: itemText(top.item) },
    value: top.row.median,
    measure: "median",
    currency: "AUD",
    unit: "per week",
    period: { from: quarterStart(d), to: d },
    reference_period: quarterLabel(d),
    sample_size: top.row.n,
    method: METHOD,
    describe: (v) =>
      `The median weekly rent of new tenancies of ${itemText(top.item)} in ${q.label}, South Australia, was ${fmtMoney(v, "AUD")} (about ${fmtMoney(monthly(v), "AUD")} a month) in the quarter ending ${d}, from ${top.row.n} rental bonds lodged.` +
      pick +
      " These are rents of new leases, not what sitting tenants pay; no range is published.",
    baseUrl: q.baseUrl,
    extra: {
      dwelling: itemText(top.item),
      median_per_month_equivalent: monthly(top.row.median),
      per_month_note: "Weekly rent x 52 / 12; the published figures are weekly.",
      bonds_lodged: top.row.n,
      ...(others.length ? { other_dwellings: others } : {}),
    },
  });
}

function latestRows(area: string, item: string): (DailyRow & { date: string }) | undefined {
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) return undefined;
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 10 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area, item, from, to });
  return rows[rows.length - 1];
}

/** True when the library holds this suburb (used to route a suburb name to this source). Never throws. */
export function knowsSuburb(name: string): boolean {
  try {
    return !!latestRows(suburbKey(name), "all") || !!latestRows(suburbKey(name), "house") || !!latestRows(suburbKey(name), "flat");
  } catch {
    return false;
  }
}

export async function saRents(input: SaInput): Promise<PriceAnswer> {
  const { area, label } = saArea(input);
  const items = saWants(input.property_type, input.bedrooms);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects the South Australian Private Rent Report daily; figures appear after the next collection.");
  const cands: Cand[] = [];
  for (const item of items) {
    const r = latestRows(area, item);
    if (r && r.n >= MIN_PUBLISH) cands.push({ item, row: r });
  }
  const ans = saAnswerFromCandidates(cands, { area, label, baseUrl: input.baseUrl });
  const ageDays = Math.round((Date.now() - Date.parse(meta.last_date + "T00:00:00Z")) / 86400000);
  if (ageDays > 150) ans.extra = { ...(ans.extra ?? {}), data_age_note: `The newest quarter held ends ${meta.last_date}, ${ageDays} days ago; the report normally appears within about six weeks of a quarter's end.` };
  return ans;
}
