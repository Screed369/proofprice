// England and Wales: the ONS Price Index of Private Rents (PIPR), monthly price statistics. One spreadsheet (about 18 MB,
// 50 000 rows) holds the average monthly private rent in pounds for England, Wales, the English regions and every
// local authority, in total and by bedrooms and by property type, plus the annual change. The file is too big to read per
// request, so the daily collector (harvest) reads it once, keeps the latest month in the price library, and requests are
// answered from there. Formats checked live on 2026-10-14 (edition 16 September 2026, latest month August 2026).
//
// Scotland and Northern Ireland are left out on purpose: the ONS says its Scottish rents are mainly advertised new lets
// (asking rents, note 8 of the workbook) and that Northern Ireland's latest months are estimated (note 3). The UK and
// Great Britain totals include both, so they are left out too.
//
// Library rows: one per area and item. area = "<ONS area code> <area name>", item = "all", "bed1".."bed4", "detached",
// "semi-detached", "terraced", "flat" (the rent in pounds per month) and "<item>:yoy" (the published annual change in
// percent). The library's row shape is built for aggregates of records, so a published figure is stored with
// median = low = high = min = max = the figure and n = 5; that n is a placeholder to pass the "at least 5" gate, NOT a count of records.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readLatestDay } from "../../lib/library/store";
import { Cell, excelDate, readXlsx } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const DATASET_URL = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";
const ONS = "https://www.ons.gov.uk";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "gb-ons-rents",
  country: "GB (England and Wales)",
  category: "rent (official rent statistics)",
  name: "Price Index of Private Rents, UK: monthly price statistics",
  publisher: "Office for National Statistics (ONS)",
  what_is_recorded:
    "The average monthly private rent in pounds, and its change over the year, for England, Wales, the English regions and local authorities, in total and by number of bedrooms and by property type. Built by the ONS from administrative data on rents; it covers new and existing tenancies in the private rented sector.",
  price_type: "official_statistic",
  freshness: "Monthly; each release adds a month about six weeks after it ends (the ONS labels these official statistics in development)",
  licence: 'Open Government Licence v3.0 (the ONS states: "All content is available under the Open Government Licence v3.0, except where otherwise stated"); Crown copyright',
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Office for National Statistics, Price Index of Private Rents, UK: monthly price statistics.",
  homepage: DATASET_URL,
  limits:
    "England and Wales only: Scotland (mainly advertised new lets) and Northern Ireland (estimated) are not used, nor the UK or Great Britain totals. One average per local authority, region or country and month: no range and no count of rents. It averages rents of all private tenancies, new and existing, so it is lower than the rent of a tenancy starting today. Local authorities, not towns or postcodes. Bedrooms and property type are published separately, never together. Official statistics in development.",
};

// ---------- finding and reading the file ----------

/** The newest edition from the dataset's /data listing (the ONS lists editions newest first). */
export function latestEditionUri(list: any): string {
  const uris: string[] = (list?.datasets ?? []).map((d: any) => d?.uri).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("/"));
  if (!uris.length) throw new SourceError("The ONS dataset page lists no editions; it may have changed and this source needs updating.");
  return uris[0];
}

/** The URL of the spreadsheet in an edition's /data record. */
export function editionFileUrl(uri: string, edition: any): string {
  const file = (edition?.downloads ?? []).map((d: any) => d?.file).find((f: unknown): f is string => typeof f === "string" && /\.xlsx$/i.test(f));
  if (!file) throw new SourceError("The ONS edition has no .xlsx download; it may have changed and this source needs updating.");
  return `${ONS}/file?uri=${uri}/${file}`;
}

export interface Measure {
  key: string; // library item
  label: string;
  rent: string; // column header of the rent in pounds
  change: string; // column header of the annual change in percent
}

export const MEASURES: Measure[] = [
  { key: "all", label: "all homes", rent: "Rental price", change: "Annual change" },
  { key: "bed1", label: "one-bedroom homes", rent: "Rental price one bed", change: "Annual change one bed" },
  { key: "bed2", label: "two-bedroom homes", rent: "Rental price two bed", change: "Annual change two bed" },
  { key: "bed3", label: "three-bedroom homes", rent: "Rental price three bed", change: "Annual change three bed" },
  { key: "bed4", label: "homes with four or more bedrooms", rent: "Rental price four or more bed", change: "Annual change four or more bed" },
  { key: "detached", label: "detached houses", rent: "Rental price detached", change: "Annual change detached" },
  { key: "semi-detached", label: "semi-detached houses", rent: "Rental price semidetached", change: "Annual change semidetached" },
  { key: "terraced", label: "terraced houses", rent: "Rental price terraced", change: "Annual change terraced" },
  { key: "flat", label: "flats and maisonettes", rent: "Rental price flat maisonette", change: "Annual change flat maisonette" },
];

export type AreaKind = "country" | "region" | "local authority";

/** England and Wales only. Anything else (UK, GB, Scotland, Northern Ireland and their areas) is not used. */
export function areaKind(code: string): AreaKind | null {
  if (code === "E92000001" || code === "W92000004") return "country";
  if (/^E12\d{6}$/.test(code)) return "region";
  if (/^(E06|E07|E08|E09|W06)\d{6}$/.test(code)) return "local authority";
  return null;
}

export interface PiprArea {
  code: string;
  name: string;
  kind: AreaKind;
  values: Record<string, { rent: number | null; change: number | null }>;
}

export interface Pipr {
  serial: number; // the latest month, as an Excel date (the first day of the month)
  month: string; // YYYY-MM
  areas: PiprArea[];
}

const asNum = (c: Cell): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null); // "[x]" and "[z]" are text

/** Parse "Table 1": find the header row by name, then keep the latest month's rows for England and Wales. */
export function parsePipr(rows: Cell[][], minAreas = 100): Pipr {
  const hi = rows.findIndex((r) => String(r[0] ?? "").trim() === "Time period");
  if (hi < 0) throw new SourceError("The ONS rents table has a new layout (no 'Time period' header row); this source needs updating.");
  const head = rows[hi].map((c) => String(c ?? "").trim());
  const col = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new SourceError(`The ONS rents table has a new layout (no '${name}' column); this source needs updating.`);
    return i;
  };
  const cCode = col("Area code");
  const cName = col("Area name");
  const cols = MEASURES.map((m) => ({ m, rent: col(m.rent), change: col(m.change) }));
  const data = rows.slice(hi + 1);
  let serial = 0;
  for (const r of data) {
    const d = asNum(r[0]);
    if (d !== null && d > serial) serial = d;
  }
  const iso = excelDate(serial);
  if (!iso) throw new SourceError("The ONS rents table has no dated rows; this source needs updating.");
  const areas: PiprArea[] = [];
  for (const r of data) {
    if (asNum(r[0]) !== serial) continue;
    const code = String(r[cCode] ?? "").trim();
    const kind = areaKind(code);
    if (!kind) continue;
    const values: PiprArea["values"] = {};
    for (const c of cols) {
      const rent = asNum(r[c.rent]);
      const change = asNum(r[c.change]);
      values[c.m.key] = { rent: rent !== null && rent > 0 ? Math.round(rent) : null, change: change !== null ? Math.round(change * 10) / 10 : null };
    }
    areas.push({ code, name: String(r[cName] ?? "").trim(), kind, values });
  }
  // The real file has about 330 England and Wales areas in a month; far fewer means the layout changed.
  if (areas.length < minAreas) throw new SourceError(`Only ${areas.length} England and Wales areas found in the latest ONS month; the file may have changed.`);
  return { serial, month: iso.slice(0, 7), areas };
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Library rows for the latest month. See the note at the top of this file about n. */
export function piprRows(p: Pipr): DailyRow[] {
  const rows: DailyRow[] = [];
  const put = (area: string, item: string, v: number) => rows.push({ area, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  for (const a of p.areas) {
    const area = `${a.code} ${a.name}`;
    for (const m of MEASURES) {
      const v = a.values[m.key];
      if (v.rent === null) continue;
      put(area, m.key, v.rent);
      if (v.change !== null) put(area, `${m.key}:yoy`, v.change);
    }
  }
  return rows;
}

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

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

/** The daily collector: find the newest edition, read its table once, keep the latest month. */
export async function gbHarvest(): Promise<HarvestResult> {
  const list = await fetchJson(`${DATASET_URL}/data`, { headers: { "user-agent": UA } }, 30000);
  const uri = latestEditionUri(list);
  const edition = await fetchJson(`${ONS}${uri}/data`, { headers: { "user-agent": UA } }, 30000);
  const sheets = readXlsx(await download(editionFileUrl(uri, edition)));
  const table = sheets.find((s) => s.rows.some((r) => String(r[0] ?? "").trim() === "Time period"));
  if (!table) throw new SourceError("The ONS workbook has no table with a 'Time period' column; this source needs updating.");
  const p = parsePipr(table.rows);
  return {
    date: monthEnd(p.month),
    currency: "GBP",
    unit: "per month",
    rows: piprRows(p),
    note: `ONS Price Index of Private Rents, ${p.month} (edition ${uri.split("/").pop()}): published average monthly rent per area and its annual change. Figures are published values, not counts of records (no record count is published).`,
  };
}

// ---------- answering ----------

export interface GbInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/,\s*(city|county) of$/, "") // "Bristol, City of" is Bristol; "City of London" stays as it is (London is the region)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface LibArea {
  code: string;
  name: string;
}

const NOT_COVERED = new Set(["uk", "united kingdom", "gb", "great britain", "britain", "scotland", "northern ireland", "ni"]);

/** Match a place name to an England or Wales area: exact name first, then a name containing the words, else a clear error. */
export function matchArea(areas: LibArea[], text: string): LibArea {
  const t = norm(text);
  if (!t) throw new InputError("A place is required: a local authority (Manchester, Leeds, Camden), a region (London, North West) or England / Wales.");
  if (NOT_COVERED.has(t)) {
    throw new InputError(
      `This source covers England and Wales only (${text} is not available: the ONS Scottish rents are mainly advertised new lets and Northern Ireland's latest months are estimated). Try England, Wales, a region or a local authority.`,
    );
  }
  const exact = areas.filter((a) => norm(a.name) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new InputError(`'${text}' matches several areas: ${exact.map((a) => a.name).join("; ")}.`);
  const words = ` ${t} `;
  const part = areas.filter((a) => ` ${norm(a.name)} `.includes(words));
  if (part.length === 1) return part[0];
  if (part.length > 1) {
    throw new InputError(`'${text}' matches several areas: ${part.slice(0, 8).map((a) => a.name).join("; ")}${part.length > 8 ? "; ..." : ""}. Give the full name.`);
  }
  throw new InputError(
    `No England or Wales area named '${text}' (this source covers England and Wales only). The ONS publishes rents by local authority (for example Manchester, Leeds, Camden, Cardiff), by region (for example London, North West) and for England and Wales as a whole; it does not publish towns or postcodes.`,
  );
}

export function gbSelect(input: { property_type?: string; house_type?: string; bedrooms?: number }): { measure: Measure; basis: "all" | "bedrooms" | "property type" } {
  const pt = input.property_type;
  if (pt === "room") throw new InputError("The ONS does not publish rents for rooms; use apartment (flat), house or leave property_type out.");
  const hasBeds = input.bedrooms !== undefined;
  const wantsType = (pt !== undefined && pt !== "any") || input.house_type !== undefined;
  if (hasBeds && wantsType) {
    throw new InputError("The ONS publishes rents by number of bedrooms or by property type, not both together. Give bedrooms or property_type (with house_type for houses), not both.");
  }
  if (hasBeds) {
    const b = input.bedrooms!;
    if (!Number.isInteger(b) || b < 1) throw new InputError("The ONS figures start at one bedroom (studios are not published separately). Use 1, 2, 3 or 4 (four or more), or leave bedrooms out.");
    return { measure: MEASURES.find((m) => m.key === `bed${Math.min(b, 4)}`)!, basis: "bedrooms" };
  }
  if (pt === "apartment") return { measure: MEASURES.find((m) => m.key === "flat")!, basis: "property type" };
  if (pt === "house" || input.house_type !== undefined) {
    const h = input.house_type;
    if (h !== "detached" && h !== "semi-detached" && h !== "terraced") {
      throw new InputError(
        h === undefined
          ? "England and Wales publish houses by type: add house_type (detached, semi-detached or terraced), or leave property_type out for all homes."
          : "house_type must be detached, semi-detached or terraced.",
      );
    }
    return { measure: MEASURES.find((m) => m.key === h)!, basis: "property type" };
  }
  return { measure: MEASURES[0], basis: "all" };
}

/** Pure: the answer for one area from the library's latest-month rows. */
export function gbAnswer(
  lib: { date: string; rows: { area: string; item: string; median: number }[] },
  input: GbInput,
  now = new Date(),
): PriceAnswer {
  const byArea = new Map<string, LibArea>();
  for (const r of lib.rows) {
    const i = r.area.indexOf(" ");
    if (i > 0 && !byArea.has(r.area)) byArea.set(r.area, { code: r.area.slice(0, i), name: r.area.slice(i + 1) });
  }
  const place = input.town?.trim() || undefined;
  if (!place) {
    throw new InputError(
      input.postcode
        ? "The ONS does not publish rents by postcode. A place is required: a local authority (Manchester, Leeds, Camden), a region (London, North West) or England / Wales."
        : "A place is required: a local authority (Manchester, Leeds, Camden), a region (London, North West) or England / Wales.",
    );
  }
  const area = matchArea([...byArea.values()], place);
  const sel = gbSelect(input);
  const key = `${area.code} ${area.name}`;
  const get = (item: string): number | null => lib.rows.find((r) => r.area === key && r.item === item)?.median ?? null;
  const value = get(sel.measure.key);
  const change = get(`${sel.measure.key}:yoy`);
  const month = lib.date.slice(0, 7);
  const period = { from: `${month}-01`, to: lib.date };
  const ageDays = Math.round((now.getTime() - Date.parse(lib.date)) / 86400000);
  const notes: string[] = [
    "Average of all private tenancies in the area (new and existing), so it sits below the rent of a tenancy starting today. Official statistics in development.",
  ];
  if (ageDays > 75) notes.push(`The latest month we hold is ${month}, which ended about ${ageDays} days ago, so rents today may differ.`);
  const display = area.name.replace(/^(.+), (City|County) of$/, "$2 of $1");
  const bedrooms: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const m of MEASURES) {
    const v = get(m.key);
    if (v === null) continue;
    if (m.key.startsWith("bed")) bedrooms[m.key === "bed4" ? "4 or more" : m.key.slice(3)] = v;
    else if (m.key !== "all") types[m.key] = v;
  }
  return buildStatisticAnswer({
    source: INFO,
    query: {
      country: "GB",
      town: display,
      property_type: input.property_type ?? "any",
      ...(input.house_type ? { house_type: input.house_type } : {}),
      bedrooms: input.bedrooms ?? null,
    },
    value,
    measure: "average",
    currency: "GBP",
    unit: "per month",
    period,
    reference_period: month,
    method:
      "England and Wales (ONS Price Index of Private Rents): the average monthly private rent published by the Office for National Statistics for the chosen local authority, region or country, bedrooms or property type, and month. We pass on the published average; it is built from administrative data on rents and covers new and existing tenancies. It is an average, not a range built from individual rents.",
    describe: (v) =>
      `The average monthly private rent for ${sel.measure.label} in ${display} was ${fmtMoney(v, "GBP")}` +
      (change === null ? "" : change === 0 ? ", unchanged on a year earlier" : `, ${change > 0 ? "up" : "down"} ${Math.abs(change)}% on a year earlier`) +
      ". It averages new and existing private tenancies, so a tenancy starting today usually costs more; one published average, not a range." +
      (ageDays > 75 ? ` That month ended about ${ageDays} days ago, so rents today may differ.` : ""),
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra:
      value !== null
        ? {
            area: { name: area.name, ons_code: area.code, kind: areaKind(area.code) },
            basis: sel.basis,
            annual_change_percent: change,
            by_bedrooms: bedrooms,
            by_property_type: types,
            all_homes: get("all"),
            rent_kind: "average private rent across new and existing tenancies (published statistic, not asking rents)",
            coverage_note: "England and Wales only; Scotland and Northern Ireland are not used.",
          }
        : undefined,
  });
}

export async function gbRents(input: GbInput, now = new Date()): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the ONS rent figures appear after the next collection (the price library has no data for this source yet).");
  return gbAnswer(lib, input, now);
}
