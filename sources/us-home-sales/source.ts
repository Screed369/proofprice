// United States home sales from three official open records, all on Socrata (SODA) portals and all queried live:
//   Connecticut statewide   data.ct.gov                      "Real Estate Sales 2001-2024 GL"        (5mzw-sjtu, OPM, annual file)
//   New York City           data.cityofnewyork.us            "NYC Citywide Rolling Calendar Sales"   (usep-8jbt, Dept of Finance, monthly)
//   Cook County, IL         datacatalog.cookcountyil.gov     "Assessor - Parcel Sales"               (wvhk-k5uv, Assessor, semi-monthly)
// This is NOT nationwide. A request is routed by place to one dataset, one SoQL query asks only for price + date of the
// sales that match (place, window, property type, exclusions), and we return aggregates only: never an address, a PIN or a name.
// Facts below (ids, fields, values, licences) were checked live on 2026-10-14 through the Probe workflow.

import { socrataAll, socrataQuery, soqlString, Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";
import { CHICAGO_TOWNSHIP_CODES, COOK_TOWNSHIPS, CT_TOWNS, NYC_BOROUGHS, NYC_NEIGHBORHOODS } from "./places";

export type UsDataset = "ct" | "nyc" | "cook";

interface DatasetFacts {
  domain: string;
  id: string;
  dateField: string;
  priceField: string;
  /** The longest window the dataset can answer, in months (New York City publishes a rolling 12 months). */
  maxMonths: number;
  info: SourceInfo;
}

const BASE = {
  id: "us-home-sales",
  category: "home sales",
  price_type: "transaction" as const,
};

const CT_INFO: SourceInfo = {
  ...BASE,
  country: "US (Connecticut)",
  name: "Real Estate Sales 2001-2024 GL",
  publisher: "State of Connecticut, Office of Policy and Management (OPM)",
  what_is_recorded: "Real estate sales of $2,000 or more recorded by Connecticut towns: town, date recorded, property type, residential type, sale amount, non-use code.",
  freshness: "Annual: one grand-list year (1 October to 30 September) at a time; the file currently runs to 30 September 2025",
  licence: "Public Domain (as labelled on the data.ct.gov dataset page)",
  licence_url: "https://data.ct.gov/d/5mzw-sjtu",
  attribution: "Source: State of Connecticut Office of Policy and Management, Real Estate Sales 2001-2024 GL (data.ct.gov). Public Domain.",
  homepage: "https://data.ct.gov/d/5mzw-sjtu",
  limits:
    "Connecticut only, by town. Aggregates only (median, range, count), never addresses. Residential sales with no non-use code (non-arm's-length sales such as family transfers, foreclosures and part interests are left out) and a sale amount of $10,000 or more. Published once a year, so the latest months are not in the file yet; some towns skip a year after a revaluation.",
};

const NYC_INFO: SourceInfo = {
  ...BASE,
  country: "US (New York City)",
  name: "NYC Citywide Rolling Calendar Sales",
  publisher: "New York City Department of Finance (published on NYC Open Data)",
  what_is_recorded: "All recorded sales in New York City over the prior twelve months: borough, neighborhood, ZIP code, building class, sale price, sale date.",
  freshness: "Monthly, around the 15th, with sales recorded through the end of the prior month",
  licence:
    "NYC Open Data Terms of Use (no licence is stated on the dataset page; NYC Admin. Code 23-502(d), the Open Data Law, says public data sets are made available 'without any registration requirement, license requirement or restrictions', with users to identify the source and version and describe any modifications; data are provided without warranty)",
  licence_url: "https://www.nyc.gov/html/data/terms.html",
  attribution:
    "Source: New York City Department of Finance, NYC Citywide Rolling Calendar Sales (NYC Open Data, data.cityofnewyork.us). Figures are ProofPrice aggregates of the published sale records; the City does not warrant the data.",
  homepage: "https://data.cityofnewyork.us/d/usep-8jbt",
  limits:
    "New York City only, by borough, neighborhood or ZIP code, over the last 12 months at most. Aggregates only, never addresses. One- to three-family houses, condos and co-ops; sales under $10,000 (nominal transfers) are left out, as are rental buildings, commercial property and vacant land.",
};

const COOK_INFO: SourceInfo = {
  ...BASE,
  country: "US (Cook County, Illinois)",
  name: "Assessor - Parcel Sales",
  publisher: "Cook County Assessor's Office (published on the Cook County Open Data portal)",
  what_is_recorded: "Real property sales in Cook County from 1999 to the present: sale price, sale date, assessment township, property class, deed type and the Assessor's sale-filter flags.",
  freshness: "Uploaded about twice a month; sales are reported on a lag, so the latest weeks are incomplete",
  licence:
    "Cook County Terms of Use (no data licence is stated on the dataset page, access level 'public'; the County provides information 'as is' without warranty)",
  licence_url: "https://www.cookcountyil.gov/terms-use",
  attribution:
    "Source: Cook County Assessor's Office, Assessor - Parcel Sales (Cook County Open Data, datacatalog.cookcountyil.gov). Figures are ProofPrice aggregates; the County provides the data without warranty.",
  homepage: "https://datacatalog.cookcountyil.gov/d/wvhk-k5uv",
  limits:
    "Cook County only: Chicago (the eight City of Chicago assessment townships), the whole county, or one assessment township. Not a municipality filter: the file has townships, not municipalities. Aggregates only, never addresses or names. Residential classes; multi-parcel sales, sales under $10,000, quit claim and executor deeds and repeat records of the same sale are left out using the Assessor's own filter flags.",
};

/** The combined record shown on /sources and /method. Every answer carries the dataset-specific block (CT_INFO, NYC_INFO, COOK_INFO) instead. */
export const INFO: SourceInfo = {
  ...BASE,
  country: "US (Connecticut, New York City, Cook County IL)",
  name: "Home sales: Connecticut Real Estate Sales, NYC Rolling Calendar Sales, Cook County Parcel Sales",
  publisher: "Connecticut OPM; New York City Department of Finance; Cook County Assessor's Office",
  what_is_recorded: "Residential sales recorded by three US public authorities: price paid, sale date, property type and place (no addresses kept).",
  freshness: "Connecticut: annual file; New York City: monthly; Cook County: about twice a month (with a reporting lag)",
  licence:
    "Differs by dataset. Connecticut: Public Domain (as labelled on data.ct.gov). New York City: NYC Open Data Terms of Use (no licence stated on the dataset; the Open Data Law requires no licence or restrictions). Cook County: Cook County Terms of Use (no data licence stated on the dataset page)",
  licence_url: "https://data.ct.gov/d/5mzw-sjtu",
  attribution:
    "Connecticut Office of Policy and Management (Real Estate Sales 2001-2024 GL); New York City Department of Finance (NYC Citywide Rolling Calendar Sales, NYC Open Data); Cook County Assessor's Office (Assessor - Parcel Sales, Cook County Open Data). Figures are ProofPrice aggregates; none of the three publishers warrants the data.",
  homepage: "https://data.ct.gov/d/5mzw-sjtu",
  limits:
    "Not nationwide: only Connecticut (by town), New York City (borough, neighborhood or ZIP code) and Cook County, Illinois (Chicago, the county, or an assessment township). Aggregates only, never addresses, parcel numbers or names. Sales under $10,000 and non-arm's-length sales are left out using each publisher's own flags. Connecticut's file is annual and currently ends 30 September 2025; New York City covers the last 12 months only; Cook County sales arrive with a lag.",
};

export const DATASETS: Record<UsDataset, DatasetFacts> = {
  ct: { domain: "data.ct.gov", id: "5mzw-sjtu", dateField: "daterecorded", priceField: "saleamount", maxMonths: 36, info: CT_INFO },
  nyc: { domain: "data.cityofnewyork.us", id: "usep-8jbt", dateField: "sale_date", priceField: "sale_price", maxMonths: 12, info: NYC_INFO },
  cook: { domain: "datacatalog.cookcountyil.gov", id: "wvhk-k5uv", dateField: "sale_date", priceField: "sale_price", maxMonths: 36, info: COOK_INFO },
};

/** Sales below this are nominal transfers or data errors, not market prices. */
export const MIN_SALE = 10_000;
/** Most sales one answer will read, however large the place is. The most recent ones are kept and the answer says so. */
export const MAX_ROWS = 30_000;
export const PAGE_SIZE = 10_000;

export const US_TYPES = ["any", "house", "condo", "coop"] as const;
export type UsType = (typeof US_TYPES)[number];

// ---------- property types in each dataset ----------

/** Connecticut: propertytype 'Residential' with these residentialtype values (checked: Single Family, Condo, Two Family, Three Family, Four Family). */
export const CT_RESIDENTIAL: Record<Exclude<UsType, "coop">, string[]> = {
  house: ["Single Family", "Two Family", "Three Family"],
  condo: ["Condo"],
  any: ["Single Family", "Two Family", "Three Family", "Four Family", "Condo"],
};

/** New York City: the two-digit prefix of building_class_category ("01 ONE FAMILY DWELLINGS"). */
export const NYC_CATEGORIES: Record<UsType, string[]> = {
  house: ["01", "02", "03"], // one, two and three family dwellings
  condo: ["04", "12", "13", "15"], // tax class 1 condos, condos walk-up, condos elevator, condos 2-10 unit residential
  coop: ["09", "10", "17"], // co-ops walk-up, co-ops elevator, condo-coops
  any: ["01", "02", "03", "04", "09", "10", "12", "13", "15", "17"],
};

/** Cook County: Assessor property classes (2-02..2-10, 2-34, 2-78, 2-95 houses and row houses; 2-11 apartment building of 2 to 6 units; 2-99 condominium). */
export const COOK_CLASSES: Record<Exclude<UsType, "coop">, string[]> = {
  house: ["202", "203", "204", "205", "206", "207", "208", "209", "210", "234", "278", "295"],
  condo: ["299"],
  any: ["202", "203", "204", "205", "206", "207", "208", "209", "210", "211", "234", "278", "295", "299"],
};

// ---------- place routing ----------

export interface UsPlace {
  dataset: UsDataset;
  /** Human label echoed in the answer, e.g. "Hartford, CT". */
  label: string;
  /** Two-letter state of the dataset. */
  state: "CT" | "NY" | "IL";
  ctTown?: string; // canonical spelling; absent = all of Connecticut
  nycBorough?: string; // "1".."5"; absent = whole city
  nycNeighborhoods?: string[]; // exact stored names
  zip?: string;
  cookTownships?: string[]; // township codes; absent = whole county
}

const COVERAGE = "Connecticut (any town), New York City (a borough, neighborhood or ZIP code) and Cook County, Illinois ('Chicago', 'Cook County' or an assessment township such as Evanston or Oak Park)";

/** Lower-case, no accents or punctuation, single spaces. "St. Albans" -> "st albans". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STATE_WORDS: Record<string, "CT" | "NY" | "IL"> = {
  ct: "CT", connecticut: "CT",
  ny: "NY", "new york": "NY",
  il: "IL", illinois: "IL",
};

/** Explicit state parameter -> CT / NY / IL, or an InputError that says what is covered. */
export function stateCode(raw: string): "CT" | "NY" | "IL" {
  const s = STATE_WORDS[norm(raw)];
  if (!s) throw new InputError(`Home sales in the US cover ${COVERAGE}; this is not a nationwide source. Not yet: ${raw.trim()}.`);
  return s;
}

/** 5-digit ZIP (a ZIP+4 is cut to 5), or an InputError. */
export function parseZip(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  if (!m) throw new InputError("postcode must be a 5-digit US ZIP code, such as 11201.");
  return m[1];
}

const NYC_ALIASES = new Set(["new york", "new york city", "nyc", "new york ny", "new york city ny", "five boroughs", "all boroughs"]);
const NYC_BOROUGH_NAMES: Record<string, string> = {
  manhattan: "1", "new york county": "1",
  bronx: "2", "the bronx": "2", "bronx county": "2",
  brooklyn: "3", "kings county": "3",
  queens: "4", "queens county": "4",
  "staten island": "5", "richmond county": "5",
};
const TOWNSHIP_BY_NAME: Map<string, string> = new Map(Object.entries(COOK_TOWNSHIPS).map(([code, name]) => [norm(name), code]));
const CT_BY_NAME: Map<string, string> = new Map(CT_TOWNS.map((t) => [norm(t), t]));

function titleCase(s: string): string {
  return s.replace(/\w[\w']*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function nycBoroughPlace(code: string): UsPlace {
  return { dataset: "nyc", state: "NY", nycBorough: code, label: `${NYC_BOROUGHS[code]}, New York City` };
}

/** Whole city, borough or neighborhood. A borough hint ("3") narrows a neighborhood name that exists in two boroughs. */
function nycPlace(name: string, boroughHint?: string): UsPlace | null {
  return nycAliasOrBorough(name) ?? nycNeighborhoodPlace(name, boroughHint);
}

function nycNeighborhoodPlace(name: string, boroughHint?: string): UsPlace | null {
  const pool = boroughHint ? NYC_NEIGHBORHOODS.filter((n) => n.borough === boroughHint) : NYC_NEIGHBORHOODS;
  const exact = pool.filter((n) => norm(n.name) === name);
  // "williamsburg" -> every WILLIAMSBURG-xxx; "upper east side" -> the three UPPER EAST SIDE (nn-nn) areas.
  const hits = exact.length ? exact : pool.filter((n) => norm(n.name).startsWith(name + " "));
  if (!hits.length) return null;
  const boroughs = [...new Set(hits.map((h) => h.borough))];
  if (boroughs.length > 1) {
    throw new InputError(
      `'${titleCase(name)}' exists in more than one borough (${boroughs.map((b) => NYC_BOROUGHS[b]).join(", ")}). Add the borough, for example '${titleCase(name)}, ${NYC_BOROUGHS[boroughs[0]]}'.`,
    );
  }
  const b = boroughs[0];
  return { dataset: "nyc", state: "NY", nycBorough: b, nycNeighborhoods: hits.map((h) => h.name), label: `${titleCase(name)}, ${NYC_BOROUGHS[b]}, New York City` };
}

function ctPlace(name: string): UsPlace | null {
  if (name === "connecticut" || name === "ct" || name === "state of connecticut") return { dataset: "ct", state: "CT", label: "Connecticut" };
  const town = CT_BY_NAME.get(name);
  return town ? { dataset: "ct", state: "CT", ctTown: town, label: `${town}, CT` } : null;
}

function cookPlace(name: string): UsPlace | null {
  if (name === "chicago") return { dataset: "cook", state: "IL", cookTownships: CHICAGO_TOWNSHIP_CODES, label: "Chicago, IL" };
  if (name === "cook county" || name === "cook" || name === "cook county il") return { dataset: "cook", state: "IL", label: "Cook County, IL" };
  const code = TOWNSHIP_BY_NAME.get(name.replace(/ township$/, ""));
  return code ? { dataset: "cook", state: "IL", cookTownships: [code], label: `${COOK_TOWNSHIPS[code]} township, Cook County, IL` } : null;
}

/** Looks like a New York City ZIP code (100xx-104xx, 110xx-116xx). Some 11xxx ZIPs are Long Island: those simply find no NYC sales. */
const NYC_ZIP = /^(10[0-4]|11[0-6])\d{2}$/;

/**
 * Route a requested place to the right dataset. Order when no state is given: New York City aliases and boroughs,
 * Connecticut towns, Cook County (Chicago, county, townships), then New York City neighborhoods. A state ("CT", "NY", "IL")
 * given as a parameter, as ", CT" after the town, or as a trailing word decides the dataset outright.
 */
export function routeUsPlace(input: { town?: string; postcode?: string; state?: string }): UsPlace {
  const zip = parseZip(input.postcode);
  let state: "CT" | "NY" | "IL" | undefined = input.state ? stateCode(input.state) : undefined;
  let boroughHint: string | undefined;
  let name = "";

  if (input.town) {
    const parts = input.town.split(",");
    name = norm(parts[0]);
    const qualifier = parts[1] ? norm(parts[1]) : "";
    if (qualifier) {
      if (STATE_WORDS[qualifier]) state = state ?? STATE_WORDS[qualifier];
      else if (NYC_BOROUGH_NAMES[qualifier]) {
        boroughHint = NYC_BOROUGH_NAMES[qualifier]; // "Williamsburg, Brooklyn" can only be New York City
        state = state ?? "NY";
      }
    }
    name = name.replace(/^(city|town|village|borough) of /, "");
    const suffix = /^(.+) (ct|connecticut|il|illinois|ny)$/.exec(name);
    if (suffix) {
      state = state ?? STATE_WORDS[suffix[2]];
      name = suffix[1];
    }
  }

  let place: UsPlace | null = null;
  if (!name) {
    if (zip && NYC_ZIP.test(zip) && (!state || state === "NY")) place = { dataset: "nyc", state: "NY", label: "New York City" };
    else if (state === "CT") place = { dataset: "ct", state: "CT", label: "Connecticut" };
    else if (state === "NY") place = { dataset: "nyc", state: "NY", label: "New York City" };
    else if (state === "IL") place = { dataset: "cook", state: "IL", label: "Cook County, IL" };
    else {
      throw new InputError(
        zip
          ? `A ZIP code alone only works for New York City ZIP codes. Give a town as well: US home sales cover ${COVERAGE}.`
          : `A town is required: US home sales cover ${COVERAGE}.`,
      );
    }
  } else if (state === "CT") place = ctPlace(name);
  else if (state === "NY") place = nycPlace(name, boroughHint);
  else if (state === "IL") place = cookPlace(name);
  else place = nycAliasOrBorough(name) ?? ctPlace(name) ?? cookPlace(name) ?? nycNeighborhoodPlace(name, boroughHint);

  if (!place) {
    const where = state === "CT" ? "a Connecticut town" : state === "NY" ? "a New York City borough or neighborhood" : state === "IL" ? "Chicago, Cook County or a Cook County assessment township" : null;
    throw new InputError(
      where
        ? `'${input.town!.trim()}' is not ${where}. US home sales cover ${COVERAGE}.`
        : `'${input.town!.trim()}' is not a place we cover yet. US home sales cover ${COVERAGE}; this is not a nationwide source. If the name exists in two places, add the state, for example 'Hartford, CT'.`,
    );
  }
  if (zip) {
    if (place.dataset !== "nyc") {
      throw new InputError("A ZIP code (postcode) can only narrow New York City sales. For Connecticut and Cook County give the town or township instead.");
    }
    place = { ...place, zip, label: `${place.label}, ZIP ${zip}` };
  }
  return place;
}

function nycAliasOrBorough(name: string): UsPlace | null {
  if (NYC_ALIASES.has(name)) return { dataset: "nyc", state: "NY", label: "New York City" };
  const b = NYC_BOROUGH_NAMES[name];
  return b ? nycBoroughPlace(b) : null;
}

// ---------- queries ----------

/** Date `months` before `last` (YYYY-MM-DD, UTC). */
export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function nextDay(date: string): string {
  return new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
}

export function clampMonths(months: number | undefined, dataset: UsDataset): { requested: number; applied: number } {
  const requested = months === undefined || !Number.isFinite(months) ? 12 : Math.max(1, Math.min(36, Math.round(months)));
  return { requested, applied: Math.min(requested, DATASETS[dataset].maxMonths) };
}

function inList(field: string, values: string[]): string {
  return `${field} in (${values.map(soqlString).join(",")})`;
}

/** The SoQL $where for one answer: place + window (from exclusive, to inclusive) + type + exclusions. All text goes through soqlString. */
export function buildWhere(place: UsPlace, type: UsType, window: { from: string; to: string }): string {
  const f = DATASETS[place.dataset];
  const c: string[] = [`${f.dateField} > '${window.from}T00:00:00'`, `${f.dateField} < '${nextDay(window.to)}T00:00:00'`, `${f.priceField} >= ${MIN_SALE}`];
  if (place.dataset === "ct") {
    if (type === "coop") throw new InputError("property_type 'coop' is only available for New York City.");
    if (place.ctTown) c.push(`town = ${soqlString(place.ctTown)}`);
    c.push(`propertytype = 'Residential'`, inList("residentialtype", CT_RESIDENTIAL[type]), "nonusecode IS NULL");
  } else if (place.dataset === "nyc") {
    if (place.nycBorough) c.push(`borough = ${soqlString(place.nycBorough)}`);
    if (place.nycNeighborhoods) c.push(inList("neighborhood", place.nycNeighborhoods));
    if (place.zip) c.push(`zip_code = ${soqlString(place.zip)}`);
    c.push("(" + NYC_CATEGORIES[type].map((n) => `building_class_category like ${soqlString(n + " %")}`).join(" OR ") + ")");
  } else {
    if (type === "coop") throw new InputError("property_type 'coop' is only available for New York City.");
    if (place.cookTownships) c.push(inList("township_code", place.cookTownships));
    c.push(
      inList("class", COOK_CLASSES[type]),
      "is_multisale = false",
      "sale_filter_same_sale_within_365 = false",
      "sale_filter_less_than_10k = false",
      "sale_filter_deed_type = false",
    );
  }
  return c.join(" AND ");
}

/** Price and date only: nothing that identifies a property or a person is ever requested. */
export function buildSelect(dataset: UsDataset): string[] {
  const f = DATASETS[dataset];
  return [f.priceField, f.dateField];
}

export function buildOrder(dataset: UsDataset): string[] {
  const f = DATASETS[dataset];
  return [`${f.dateField} DESC`, `${f.priceField} DESC`];
}

export interface UsSale {
  price: number;
  date: string; // YYYY-MM-DD
}

/** SoQL returns numbers as strings. Rows without a usable price or date are dropped. */
export function parseSales(dataset: UsDataset, rows: Record<string, any>[]): UsSale[] {
  const f = DATASETS[dataset];
  const out: UsSale[] = [];
  for (const r of rows) {
    const price = Number(r[f.priceField]);
    const date = String(r[f.dateField] ?? "").slice(0, 10);
    if (Number.isFinite(price) && price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ price, date });
  }
  return out;
}

/** Latest sale date in a dataset: the answer's window ends there. Reads {latest: "2025-09-30T00:00:00.000"}. */
export function parseLatest(rows: Record<string, any>[]): string | null {
  const v = rows[0]?.latest;
  const d = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const LATEST_TTL_MS = 6 * 3600 * 1000;
const latestCache = new Map<UsDataset, { date: string; at: number }>();
export function clearLatestCache(): void {
  latestCache.clear();
}

async function datasetLatest(dataset: UsDataset, today: Date, fetcher?: Fetcher): Promise<string> {
  const hit = latestCache.get(dataset);
  if (hit && !fetcher && Date.now() - hit.at < LATEST_TTL_MS) return hit.date;
  const f = DATASETS[dataset];
  const tomorrow = nextDay(today.toISOString().slice(0, 10)); // ignore mistyped future dates in the file
  const rows = await socrataQuery(f.domain, f.id, { select: `max(${f.dateField}) as latest`, where: `${f.dateField} < '${tomorrow}T00:00:00'` }, { fetcher, timeoutMs: 25000 });
  const date = parseLatest(rows);
  if (!date) throw new SourceError(`The ${f.info.name} dataset returned no latest sale date`);
  if (!fetcher) latestCache.set(dataset, { date, at: Date.now() });
  return date;
}

// ---------- the answer ----------

function typeNoun(type: UsType, dataset: UsDataset): string {
  if (type === "house") return dataset === "nyc" ? "One- to three-family houses" : dataset === "cook" ? "Houses and townhomes" : "Houses (one to three family)";
  if (type === "condo") return "Condos";
  if (type === "coop") return "Co-op apartments";
  return dataset === "nyc" ? "Homes (houses, condos and co-ops)" : dataset === "cook" ? "Homes (houses, condos and small apartment buildings)" : "Homes";
}

function methodText(dataset: UsDataset, type: UsType, applied: number, latest: string): string {
  if (dataset === "ct") {
    return (
      `Median and 10th–90th percentile of residential sales recorded by Connecticut towns (OPM file Real Estate Sales 2001-2024 GL) in the ${applied} months up to the latest recorded sale in the file (${latest}). ` +
      "Sales with a non-use code (non-arm's-length: family sales, foreclosures, part interests, court orders and so on) and sales under $10,000 are excluded. " +
      "The state publishes the file once a year, so the most recent months are not in it yet."
    );
  }
  if (dataset === "nyc") {
    return (
      `Median and 10th–90th percentile of ${typeNoun(type, dataset).toLowerCase()} recorded by the NYC Department of Finance in the ${applied} months up to its latest recorded sale (${latest}). ` +
      "Sales at $0 and other nominal transfers (under $10,000) are excluded, as are rental buildings, commercial property and vacant land. " +
      "A sale of several units in one deal can repeat its total price on each unit; the median and range are robust to this but not immune."
    );
  }
  return (
    `Median and 10th–90th percentile of residential sales in the Cook County Assessor's Parcel Sales file in the ${applied} months up to its latest recorded sale (${latest}). ` +
    "Excluded with the Assessor's own flags: multi-parcel sales, sales under $10,000, quit claim and executor deeds, and repeat records of the same sale within 365 days. " +
    "Cook County sales are reported on a lag, so the latest weeks are incomplete; 'Chicago' means the eight City of Chicago assessment townships."
  );
}

export interface UsHomeSalesInput {
  town?: string;
  postcode?: string;
  state?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}

export interface UsHomeSalesOptions {
  /** Replace the network call (tests). */
  fetcher?: Fetcher;
  today?: Date;
}

export async function usHomeSales(input: UsHomeSalesInput, opts: UsHomeSalesOptions = {}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as UsType;
  if (!(US_TYPES as readonly string[]).includes(type)) {
    throw new InputError(`property_type must be one of: ${US_TYPES.join(", ")} (coop is New York City only).`);
  }
  const place = routeUsPlace(input);
  if (type === "coop" && place.dataset !== "nyc") throw new InputError("property_type 'coop' is only available for New York City.");
  const f = DATASETS[place.dataset];
  const { requested, applied } = clampMonths(input.months, place.dataset);
  const latest = await datasetLatest(place.dataset, opts.today ?? new Date(), opts.fetcher);
  const window = { from: monthsBack(latest, applied), to: latest };
  const where = buildWhere(place, type, window);

  const collected = await socrataAll(
    f.domain,
    f.id,
    { select: buildSelect(place.dataset), where, order: buildOrder(place.dataset), limit: MAX_ROWS },
    { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: PAGE_SIZE, timeoutMs: 25000 },
  );
  const sales = parseSales(place.dataset, collected.rows);
  const dates = sales.map((s) => s.date).sort();
  const summary = summarise(sales.map((s) => s.price));

  const notes: string[] = [];
  if (requested > applied) notes.push(`${f.info.name} covers the last ${f.maxMonths} months only; asked for ${requested}, used ${applied}.`);
  if (collected.truncated) notes.push(`Result capped at the ${MAX_ROWS.toLocaleString("en-US")} most recent matching sales; ask for a narrower place for the full window.`);
  if (place.dataset === "ct") notes.push(`Connecticut publishes this file once a year; its latest recorded sale is ${latest}.`);
  if (place.dataset === "cook") notes.push("Cook County sales are reported on a lag, so the most recent weeks hold fewer sales than they will.");

  return buildAnswer({
    source: f.info,
    query: { country: "US", town: input.town ?? null, postcode: place.zip ?? null, state: place.state, property_type: type, months: applied },
    summary,
    currency: "USD",
    unit: type === "any" ? "per sale" : "per home",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method: methodText(place.dataset, type, applied, latest),
    describe: (x) => `${typeNoun(type, place.dataset)} in ${place.label} sold for a median of ${fmtMoney(x.median, "USD")}; typical range ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")}.`,
    baseUrl: input.baseUrl,
    extra: {
      area: place.label,
      dataset: { name: f.info.name, id: f.id, url: f.info.homepage },
      window: { months: applied, from_exclusive: window.from, to: window.to },
      dataset_latest_sale: latest,
      ...(notes.length ? { notes } : {}),
    },
  });
}
