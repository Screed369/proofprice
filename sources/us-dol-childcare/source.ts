// United States: the Department of Labor Women's Bureau "National Database of Childcare Prices" (NDCP). One workbook
// (about 92 MB; its single worksheet is ~560 MB of XML) holds, for every US county and every year 2008-2022, the median and
// 75th percentile WEEKLY price of full-time childcare charged by providers, by age of child (infant, toddler, preschool,
// school-age) and by setting (centre-based "C", and home-based "family childcare" "FCC"), plus a quality flag for the
// infant/toddler/preschool figures. The workbook is far too big to read per request, so the daily collector (harvest) streams
// it once (./xlsx-stream.ts), keeps the latest year for each county in the price library, and requests are answered from there.
// Formats checked live on 2026-10-14 (file NDCP2022.xlsx, 91 691 849 bytes, 48 308 data rows = 3 142 counties x 15 years 2008-2022):
//  - sheet "County_LevelNDCP_v8_update2008_"; row 1 is the header (upper case names such as STATE_ABBREVIATION, COUNTY_NAME,
//    COUNTY_FIPS_CODE, STUDYYEAR, MCINFANT, MCInfant_flag, MCTODDLER, MCPRESCHOOL, MCSA, MFCCINFANT, ..., _75CINFANT, ..., _75FCCSA);
//  - the OLDER archive file nationaldatabaseofchildcareprices.xlsx (2008-2018) has the same names in mixed case: names are matched upper-cased.
//
// Library rows: one per county and item. area = "<5-digit FIPS> <County name>, <ST>" (for example "17031 Cook County, IL"),
// item = "<age>:<setting>" with age infant | toddler | preschool | school-age and setting centre | home. The library's row shape is
// built for aggregates of records, so a published figure is stored with median = low = high = the published median price
// (US dollars per week), n = 5 (a placeholder to pass the "at least 5" gate, NOT a count of records), min = DOL's quality flag
// code for that figure (0 when DOL publishes none) and max = the published 75th percentile price (0 when none).
// The library date is the last day of the reference year (2022-12-31).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readLatestDay } from "../../lib/library/store";
import type { Cell } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { openWorkbook, streamSheet } from "./xlsx-stream";

export const PAGE_URL = "https://www.dol.gov/agencies/wb/topics/featured-childcare";
export const FALLBACK_FILE_URL = "https://www.dol.gov/sites/dolgov/files/WB/NDCP2022.xlsx";
const DOL = "https://www.dol.gov";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "us-dol-childcare",
  country: "US",
  category: "childcare (official county-level childcare prices)",
  name: "National Database of Childcare Prices (NDCP)",
  publisher: "U.S. Department of Labor, Women's Bureau",
  what_is_recorded:
    "The median (and 75th percentile) weekly price of full-time childcare that providers charge parents, for every US county, by age of child (infant, toddler, preschool, school-age) and by setting (child care centre or home-based family childcare). Built by the Women's Bureau from state childcare market rate surveys and other administrative data, with estimates where a county has no survey data. Prices charged to parents, before any public subsidy.",
  price_type: "official_statistic",
  freshness: "County prices for 2022 (the latest year the Department of Labor has published; the database lags by several years)",
  licence: "US Government work, public domain. The Department of Labor says: \"Materials created by the federal government are generally part of the public domain and may be used, reproduced and distributed without permission. Therefore, content on this website which is in the public domain may be used without the prior permission of the U.S. Department of Labor (DOL). However, such materials may not be used in a manner that implies any affiliation or endorsement by the DOL of your company, website or publication.\" (Public Domain, Copyright, Trademark & Patent Information Schedule)",
  licence_url: "https://www.dol.gov/general/aboutdol/copyright",
  attribution: "Source: U.S. Department of Labor, Women's Bureau, National Database of Childcare Prices (2008-2022). Not endorsed by the Department of Labor.",
  homepage: PAGE_URL,
  limits:
    "Full-time weekly prices only (no part-time or hourly prices). The latest year is 2022, so today's prices are likely higher. County level only: no city, ZIP or state figure is published in the county file. Some county figures are estimated by the Department of Labor (see the quality flag in extra and the DOL technical report). The school-age series carries no quality flag. Dollars are as published for the year, not inflation-adjusted by us.",
};

// ---------- the library's item keys ----------

export const AGES = ["infant", "toddler", "preschool", "school-age"] as const;
export type Age = (typeof AGES)[number];
export const SETTINGS = ["centre", "home"] as const;
export type Setting = (typeof SETTINGS)[number];

// Upper-case header names of the median, 75th percentile and flag columns for each library item.
const COLUMNS: { item: string; median: string; p75: string; flag?: string }[] = [
  { item: "infant:centre", median: "MCINFANT", p75: "_75CINFANT", flag: "MCINFANT_FLAG" },
  { item: "toddler:centre", median: "MCTODDLER", p75: "_75CTODDLER", flag: "MCTODDLER_FLAG" },
  { item: "preschool:centre", median: "MCPRESCHOOL", p75: "_75CPRESCHOOL", flag: "MCPRESCHOOL_FLAG" },
  { item: "school-age:centre", median: "MCSA", p75: "_75CSA" },
  { item: "infant:home", median: "MFCCINFANT", p75: "_75FCCINFANT", flag: "MFCCINFANT_FLAG" },
  { item: "toddler:home", median: "MFCCTODDLER", p75: "_75FCCTODDLER", flag: "MFCCTODDLER_FLAG" },
  { item: "preschool:home", median: "MFCCPRESCHOOL", p75: "_75FCCPRESCHOOL", flag: "MFCCPRESCHOOL_FLAG" },
  { item: "school-age:home", median: "MFCCSA", p75: "_75FCCSA" },
];
const REQUIRED = ["STATE_ABBREVIATION", "COUNTY_NAME", "COUNTY_FIPS_CODE", "STUDYYEAR", ...COLUMNS.flatMap((c) => [c.median])];

export interface CountyPrices {
  fips: string;
  name: string;
  state: string;
  year: number;
  values: Record<string, { median: number; p75: number; flag: number }>;
}

/** Header row -> column positions, matched upper-cased. Throws when the layout is not the one we know. */
export function headerIndex(header: Cell[]): Map<string, number> {
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = String(h ?? "").trim().toUpperCase();
    if (k && !idx.has(k)) idx.set(k, i);
  });
  const missing = REQUIRED.filter((c) => !idx.has(c));
  if (missing.length) throw new SourceError(`The NDCP workbook has no column ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}; the file may have changed and this source needs updating.`);
  return idx;
}

const positive = (c: Cell | undefined): number | null => {
  const n = typeof c === "number" ? c : typeof c === "string" && c.trim() !== "" ? Number(c) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One county-year row of the workbook, projected to what we keep. Null when the row has no county or year. */
export function projectRow(cells: Cell[], idx: Map<string, number>): CountyPrices | null {
  const at = (name: string) => cells[idx.get(name) ?? -1];
  const fipsRaw = at("COUNTY_FIPS_CODE");
  const fips = String(fipsRaw ?? "").replace(/\.0+$/, "").trim().padStart(5, "0");
  const year = Number(at("STUDYYEAR"));
  const name = String(at("COUNTY_NAME") ?? "").trim();
  const state = String(at("STATE_ABBREVIATION") ?? "").trim().toUpperCase();
  if (!/^\d{5}$/.test(fips) || !Number.isInteger(year) || !name || !/^[A-Z]{2}$/.test(state)) return null;
  const values: CountyPrices["values"] = {};
  for (const c of COLUMNS) {
    const median = positive(at(c.median));
    if (median === null) continue;
    const flag = c.flag && idx.has(c.flag) ? Number(at(c.flag)) : 0;
    values[c.item] = { median, p75: positive(at(c.p75)) ?? 0, flag: Number.isFinite(flag) ? flag : 0 };
  }
  return { fips, name, state, year, values };
}

export function areaKey(c: Pick<CountyPrices, "fips" | "name" | "state">): string {
  return `${c.fips} ${c.name}, ${c.state}`;
}

/** Library rows for the counties of the latest year. See the note at the top of this file about n, min and max. */
export function ndcpRows(counties: CountyPrices[]): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const c of counties) {
    // A county the file lists for the year but without any price (DOL leaves some blank) gets one marker row, so we can say so.
    if (!Object.keys(c.values).length) rows.push({ area: areaKey(c), item: "nodata", n: 5, median: 1, low: 1, high: 1, min: 0, max: 0 });
    for (const [item, v] of Object.entries(c.values)) {
      rows.push({ area: areaKey(c), item, n: 5, median: v.median, low: v.median, high: v.median, min: v.flag, max: v.p75 });
    }
  }
  return rows;
}

/** Pick the file to download: the highest "NDCP<year>.xlsx" the DOL page links to (state-level files have longer names). */
export function pickFileUrl(html: string): string | null {
  let best: { year: number; path: string } | null = null;
  for (const m of html.matchAll(/href="([^"]*?\/NDCP(\d{4})\.xlsx)"/gi)) {
    const year = Number(m[2]);
    if (!best || year > best.year) best = { year, path: m[1] };
  }
  if (!best) return null;
  return best.path.startsWith("http") ? best.path : `${DOL}${best.path.startsWith("/") ? "" : "/"}${best.path}`;
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

/** Stream the workbook and keep, for each county, its latest year. Returns the counties at the newest year in the file. */
export async function readNdcp(buf: Buffer, minPriced = 2000): Promise<{ year: number; counties: CountyPrices[]; rowsRead: number }> {
  const wb = openWorkbook(buf);
  const entry = wb.dir.get(wb.sheetPath);
  if (!entry) throw new SourceError("The NDCP workbook has no worksheet to read.");
  const state: { idx: Map<string, number> | null } = { idx: null };
  const latest = new Map<string, CountyPrices>();
  let rowsRead = 0;
  await streamSheet(buf, entry, wb.shared, (cells) => {
    if (!state.idx) {
      state.idx = headerIndex(cells);
      return;
    }
    rowsRead++;
    const c = projectRow(cells, state.idx);
    if (!c) return;
    const prev = latest.get(c.fips);
    if (!prev || c.year > prev.year) latest.set(c.fips, c);
  });
  if (!state.idx) throw new SourceError("The NDCP workbook is empty.");
  const year = Math.max(0, ...[...latest.values()].map((c) => c.year));
  const counties = [...latest.values()].filter((c) => c.year === year);
  // The real 2022 file lists 3 221 counties for 2022 (including Puerto Rico), 2 696 of them with a price; far fewer means the layout changed.
  const priced = counties.filter((c) => Object.keys(c.values).length > 0).length;
  if (priced < minPriced) throw new SourceError(`Only ${priced} counties with prices found for ${year} in the NDCP workbook; the file may have changed.`);
  return { year, counties, rowsRead };
}

/** The daily collector: find the newest NDCP workbook, stream it once, keep the latest year of every county. */
export async function usHarvest(): Promise<HarvestResult> {
  let url = FALLBACK_FILE_URL;
  try {
    const res = await fetch(PAGE_URL, { headers: { "user-agent": UA } });
    if (res.ok) url = pickFileUrl(await res.text()) ?? FALLBACK_FILE_URL;
  } catch {
    // keep the known file
  }
  const { year, counties, rowsRead } = await readNdcp(await download(url));
  return {
    date: `${year}-12-31`,
    currency: "USD",
    unit: "per week",
    rows: ndcpRows(counties),
    note: `Department of Labor National Database of Childcare Prices (${url.split("/").pop()}), year ${year}, ${counties.length} counties (${rowsRead} county-year rows read): published median weekly price of full-time care. Figures are published values, not counts of records (n=5 is a placeholder; min holds DOL's quality flag, max the 75th percentile price).`,
  };
}

// ---------- answering ----------

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", "washington dc": "DC", "washington d c": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const STATE_CODES = new Set(Object.values(STATES));
const SUFFIX = /\s+(county|parish|borough|census area|municipality|city and borough|city)$/;

const plain = (s: string) =>
  s.toLowerCase().replace(/\bst\.?\s/g, "saint ").replace(/\bste\.?\s/g, "sainte ").replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export interface LibCounty {
  key: string; // library area
  fips: string;
  name: string;
  state: string;
}

export function parseLibArea(area: string): LibCounty | null {
  const m = /^(\d{5}) (.+), ([A-Z]{2})$/.exec(area);
  return m ? { key: area, fips: m[1], name: m[2], state: m[3] } : null;
}

/** "Cook County, IL", "cook, illinois", "17031" -> the one county, or an InputError that says how to be more precise. */
export function matchCounty(counties: LibCounty[], text: string): LibCounty {
  const raw = text.trim();
  if (/^\d{5}$/.test(raw)) {
    const hit = counties.find((c) => c.fips === raw);
    if (hit) return hit;
    throw new InputError(`Give a county that exists in the NDCP file: no county has the FIPS code ${raw}.`);
  }
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  let stateCode: string | undefined;
  let place = parts[0] ?? "";
  if (parts.length >= 2) {
    const s = plain(parts[parts.length - 1]);
    stateCode = STATE_CODES.has(s.toUpperCase()) ? s.toUpperCase() : STATES[s];
    if (!stateCode) throw new InputError(`Give a US state as a two-letter code or a name after the county, for example "Cook County, IL"; "${parts[parts.length - 1]}" is not one.`);
    place = parts.slice(0, -1).join(" ");
  } else {
    // "Cook County IL" / "Cook County Illinois": a trailing state at the end of one phrase.
    const words = plain(raw).split(" ");
    for (const take of [2, 1]) {
      if (words.length <= take) continue;
      const tail = words.slice(-take).join(" ");
      const code = STATE_CODES.has(tail.toUpperCase()) && take === 1 ? tail.toUpperCase() : STATES[tail];
      if (code) {
        stateCode = code;
        place = words.slice(0, -take).join(" ");
        break;
      }
    }
  }
  const full = plain(place);
  const base = full.replace(SUFFIX, "");
  if (!base) throw new InputError("A county is required, for example \"Cook County, IL\".");
  let pool = stateCode ? counties.filter((c) => c.state === stateCode) : counties;
  let hits = pool.filter((c) => plain(c.name) === full);
  if (!hits.length) hits = pool.filter((c) => plain(c.name).replace(SUFFIX, "") === base);
  if (!hits.length && !stateCode && STATES[full]) {
    throw new InputError(`The Department of Labor county file has no state figure. Give a county in ${place}, for example "<county> County, ${STATES[full]}".`);
  }
  if (!hits.length && !stateCode && STATE_CODES.has(full.toUpperCase())) {
    throw new InputError(`The Department of Labor county file has no state figure. Give a county in ${full.toUpperCase()}, for example "<county> County, ${full.toUpperCase()}".`);
  }
  if (!hits.length) {
    throw new InputError(`No county called "${place}"${stateCode ? ` in ${stateCode}` : ""} in the Department of Labor file. Give a US county such as "Cook County, IL" (cities are not published; use the county they are in).`);
  }
  if (hits.length > 1) {
    const where = hits.map((h) => `${h.name}, ${h.state}`).slice(0, 8).join("; ");
    throw new InputError(`Give a state as well: more than one county matches "${place}" (${where}).`);
  }
  return hits[0];
}

export interface UsInput {
  area?: string;
  age_group?: string;
  care_type?: string;
  hours?: string;
  baseUrl?: string;
}

const AGE_LABEL: Record<Age, string> = {
  infant: "infant care (under 2 years old)",
  toddler: "toddler care (2 years old)",
  preschool: "preschool care (3 years old to school age)",
  "school-age": "school-age care",
};
const SETTING_LABEL: Record<Setting, string> = { centre: "child care centres", home: "home-based family childcare" };

/** Pure: the answer for one county from the library's rows. */
export function usAnswer(lib: { date: string; rows: { area: string; item: string; median: number; min: number; max: number }[] }, input: UsInput, now = new Date()): PriceAnswer {
  const counties: LibCounty[] = [];
  const seen = new Set<string>();
  for (const r of lib.rows) {
    if (seen.has(r.area)) continue;
    seen.add(r.area);
    const c = parseLibArea(r.area);
    if (c) counties.push(c);
  }
  const place = input.area?.trim();
  if (!place) throw new InputError("A county is required, for example \"Cook County, IL\". The Department of Labor publishes prices by county only.");
  if (input.hours && input.hours !== "full-time") {
    throw new InputError('hours must be "full-time" (or left out): the Department of Labor publishes full-time weekly prices only.');
  }
  const age = (input.age_group as Age | undefined) ?? "infant";
  if (!AGES.includes(age)) throw new InputError('age_group must be "infant", "toddler", "preschool" or "school-age".');
  const setting: Setting = input.care_type === "home-based" || input.care_type === "childminder" ? "home" : "centre";
  const county = matchCounty(counties, place);
  const get = (item: string) => lib.rows.find((r) => r.area === county.key && r.item === item);
  const row = get(`${age}:${setting}`);
  const noData = !!get("nodata");
  const year = Number(lib.date.slice(0, 4));
  const yearsOld = now.getUTCFullYear() - year;
  const notes: string[] = [
    `The Department of Labor's database currently ends in ${year}${yearsOld >= 1 ? `, ${yearsOld} year${yearsOld === 1 ? "" : "s"} ago` : ""}; childcare prices have generally risen since, so treat this as a floor for today's price.`,
    "A median weekly price for full-time care as charged to parents, before subsidies. DOL estimates the figure where a county has no survey data.",
  ];
  if (!input.age_group) notes.push("No age_group was given, so the answer is for infants; see by_age_group for the others.");
  const byAge: Record<string, Record<string, number>> = {};
  for (const a of AGES) {
    for (const s of SETTINGS) {
      const r = get(`${a}:${s}`);
      if (r) (byAge[a] ??= {})[s === "centre" ? "centre_based" : "home_based"] = r.median;
    }
  }
  const display = `${county.name}, ${county.state}`;
  return buildStatisticAnswer({
    source: INFO,
    query: {
      country: "US",
      area: display,
      age_group: age,
      care_type: setting === "centre" ? "centre" : "home-based",
      hours: "full-time",
    },
    value: row?.median ?? null,
    measure: "median",
    currency: "USD",
    unit: "per week",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method:
      "United States (Department of Labor, National Database of Childcare Prices): the median weekly price of full-time care that providers charge parents, for the chosen county, age of child and setting (child care centre or home-based family childcare), for the latest year in the database. Published by the Women's Bureau from state childcare market rate surveys and other administrative data, with estimates for counties without survey data. We pass on the published median; it is a price list figure before subsidies, not a range built from individual bills.",
    describe: (v) => `The median price charged for full-time ${AGE_LABEL[age]} in ${SETTING_LABEL[setting]} in ${display} was ${fmtMoney(v, "USD")} a week in ${year}.`,
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: row
      ? {
          area: { county: county.name, state: county.state, fips: county.fips },
          age_group: age,
          care_type: setting === "centre" ? "centre" : "home-based",
          hours: "full-time",
          price_basis: "median weekly price charged by providers for full-time care, before public subsidies",
          percentile_75: row.max > 0 ? row.max : null,
          percentile_75_note: "The 75th percentile price in the county (a quarter of provider prices are higher), as published; it is not a 90th percentile.",
          quality_flag: row.min > 0 ? row.min : null,
          quality_flag_note: "DOL's code for how the figure was obtained; its meaning is in the DOL technical report (https://www.dol.gov/agencies/wb/topics/featured-childcare). The school-age series has no flag.",
          by_age_group: byAge,
          data_year: year,
          data_age_years: yearsOld,
          not_included: "part-time prices, hourly prices, city or ZIP figures, and any price after " + year,
        }
      : {
          area: { county: county.name, state: county.state, fips: county.fips },
          reason: noData
            ? `The Department of Labor lists ${display} for ${year} but publishes no childcare price for it (it leaves some counties blank).`
            : `The Department of Labor publishes no ${age} price for ${setting === "centre" ? "child care centres" : "home-based family childcare"} in ${display} for ${year}.`,
        },
  });
}

export async function usChildcare(input: UsInput, now = new Date()): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the Department of Labor childcare prices appear after the next collection (the price library has no data for this source yet).");
  return usAnswer(lib, input, now);
}
