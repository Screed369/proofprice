// United States (New York City only): commercial premises and commercial vacant land sale prices from the Department of
// Finance "NYC Citywide Rolling Calendar Sales" file on NYC Open Data (Socrata dataset usep-8jbt), queried live.
// Same dataset as the NYC part of sources/us-home-sales (which answers homes); this source answers tax class 4 (commercial).
// Aggregates only: block numbers are fetched only to drop repeated rows of one deal and are never returned.
// Formats checked live on 2026-10-24 through the Probe workflow (probes nyccat1, nycrows5).
import { socrataAll, socrataQuery, soqlString, Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "data.cityofnewyork.us";
export const DATASET = "usep-8jbt";

export const INFO: SourceInfo = {
  id: "us-nyc-commercial",
  country: "US (New York City)",
  category: "commercial property and land",
  name: "NYC Citywide Rolling Calendar Sales: commercial (tax class 4) premises and vacant land",
  publisher: "New York City Department of Finance (published on NYC Open Data)",
  what_is_recorded: "All recorded sales in New York City over the prior twelve months: borough, neighborhood, ZIP code, building class, floor area, land area, sale price, sale date.",
  price_type: "transaction",
  freshness: "Monthly, around the 15th, with sales recorded through the end of the prior month",
  licence:
    "NYC Open Data Terms of Use (no licence is stated on the dataset page; NYC Admin. Code 23-502(d), the Open Data Law, says public data sets are made available 'without any registration requirement, license requirement or restrictions on their use'; data are provided without warranty)",
  licence_url: "https://www.nyc.gov/html/data/terms.html",
  attribution:
    "Source: New York City Department of Finance, NYC Citywide Rolling Calendar Sales (NYC Open Data, data.cityofnewyork.us). Figures are ProofPrice aggregates of the published sale records; the City does not warrant the data.",
  homepage: "https://data.cityofnewyork.us/d/usep-8jbt",
  limits:
    "New York City only (five boroughs), the latest 12 months only. Aggregates only (median, range, count), never addresses or block and lot numbers. " +
    "Commercial = tax class 4 offices, stores, lofts, factories, garages and warehouses that have a recorded gross floor area; condominium units, hotels, parking and public or religious buildings are left out (condo units carry no floor area in the file). " +
    "Land = commercial vacant land with a recorded land area. Sales under $100,000, sales under US$100 per m² and sales over US$100,000 per m² are dropped as nominal transfers or data errors. " +
    "A deal covering several lots can repeat its total price on each lot; rows with the same block, price, date and floor area are counted once.",
};

export const US_TYPES = ["commercial", "land"] as const;
export type UsType = (typeof US_TYPES)[number];

/** Building class categories counted as commercial premises (stored with their number prefix, e.g. "22 STORE BUILDINGS"). */
export const COMMERCIAL_CATEGORIES = ["21 OFFICE BUILDINGS", "22 STORE BUILDINGS", "23 LOFT BUILDINGS", "27 FACTORIES", "29 COMMERCIAL GARAGES", "30 WAREHOUSES"];
export const LAND_CATEGORIES = ["31 COMMERCIAL VACANT LAND"];

export const LIMITS = { minPrice: 100_000, minPerSqm: 100, maxPerSqm: 100_000, minAreaSqm: 10 };
export const MAX_ROWS = 20_000;
export const PAGE_SIZE = 10_000;
const SQM_PER_SQFT = 0.09290304;

export const BOROUGHS: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island" };
const BOROUGH_NAMES: Record<string, string> = {
  manhattan: "1", "new york county": "1", "the bronx": "2", bronx: "2", brooklyn: "3", kings: "3", "kings county": "3",
  queens: "4", "queens county": "4", "staten island": "5", richmond: "5", "richmond county": "5",
};
const CITY_ALIASES = new Set(["new york", "new york city", "nyc", "new york ny", "new york city ny", "five boroughs", "all boroughs", "ny"]);
const NYC_ZIP = /^(10[0-4]|11[0-6])\d{2}$/;

export interface UsPlace {
  borough?: string; // "1".."5"
  neighborhood?: string; // upper-case search text
  zip?: string;
  label: string;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Route a request to a New York City place. Throws InputError for anything that is not New York City. */
export function routePlace(input: { town?: string; postcode?: string }): UsPlace {
  const zipRaw = (input.postcode ?? "").replace(/\D/g, "").slice(0, 5);
  if (input.postcode) {
    if (!NYC_ZIP.test(zipRaw)) throw new InputError("postcode must be a 5-digit New York City ZIP code (for example 10017). This source covers New York City only.");
    return { zip: zipRaw, label: `ZIP ${zipRaw}, New York City` };
  }
  const raw = (input.town ?? "").trim();
  if (!raw) return { label: "New York City" };
  let name = norm(raw);
  let boroughHint: string | undefined;
  const parts = raw.split(",").map((x) => norm(x)).filter(Boolean);
  if (parts.length > 1) {
    const q = parts[parts.length - 1].replace(/ (ny|new york)$/, "").trim();
    if (BOROUGH_NAMES[q]) {
      boroughHint = BOROUGH_NAMES[q];
      name = parts.slice(0, -1).join(" ");
    } else if (CITY_ALIASES.has(q) || q === "ny") name = parts.slice(0, -1).join(" ");
  }
  name = name.replace(/ (ny|new york city|nyc)$/, "").trim();
  if (CITY_ALIASES.has(name) || !name) return boroughHint ? { borough: boroughHint, label: `${BOROUGHS[boroughHint]}, New York City` } : { label: "New York City" };
  if (BOROUGH_NAMES[name]) {
    const b = BOROUGH_NAMES[name];
    return { borough: b, label: `${BOROUGHS[b]}, New York City` };
  }
  const clean = name.toUpperCase().replace(/[^A-Z0-9 \-/()]/g, "").trim();
  if (clean.length < 3) throw new InputError("Give a New York City borough (Manhattan, Brooklyn, Queens, Bronx, Staten Island), a neighborhood such as 'Midtown East' or 'SoHo', or a ZIP code.");
  return {
    ...(boroughHint ? { borough: boroughHint } : {}),
    neighborhood: clean,
    label: `${titleCase(name)}${boroughHint ? `, ${BOROUGHS[boroughHint]}` : ""}, New York City`,
  };
}

export function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function clampMonths(months: number | undefined): { requested: number; applied: number } {
  const requested = months === undefined || !Number.isFinite(months) ? 12 : Math.max(1, Math.min(36, Math.round(months)));
  return { requested, applied: Math.min(requested, 12) };
}

/** The SoQL $where for one answer. All text goes through soqlString. */
export function buildWhere(place: UsPlace, type: UsType, window: { from: string; to: string }): string {
  const cats = type === "commercial" ? COMMERCIAL_CATEGORIES : LAND_CATEGORIES;
  const c: string[] = [
    `sale_date > '${window.from}T00:00:00'`,
    `sale_date < '${nextDay(window.to)}T00:00:00'`,
    `sale_price >= ${LIMITS.minPrice}`,
    "tax_class_at_time_of_sale = 4",
    `building_class_category in (${cats.map(soqlString).join(",")})`,
  ];
  if (place.borough) c.push(`borough = ${soqlString(place.borough)}`);
  if (place.zip) c.push(`zip_code = ${soqlString(place.zip)}`);
  if (place.neighborhood) c.push(`upper(neighborhood) like ${soqlString("%" + place.neighborhood + "%")}`);
  return c.join(" AND ");
}

/** Block is requested only to collapse repeated rows of one deal; it is never returned. */
export function buildSelect(): string[] {
  return ["block", "sale_price", "sale_date", "gross_square_feet", "land_square_feet"];
}

export interface CommercialSale {
  price: number;
  date: string; // YYYY-MM-DD
  perSqm: number;
}

function area(v: unknown): number {
  return Number(String(v ?? "").replace(/,/g, ""));
}

/** SoQL returns numbers as strings and land area with thousands commas ("1,443"). Drops nominal and implausible rows and repeated lots. */
export function parseSales(rows: Record<string, any>[], type: UsType): CommercialSale[] {
  const seen = new Set<string>();
  const out: CommercialSale[] = [];
  for (const r of rows) {
    const price = Number(r.sale_price);
    const date = String(r.sale_date ?? "").slice(0, 10);
    const sqft = area(type === "commercial" ? r.gross_square_feet : r.land_square_feet);
    if (!Number.isFinite(price) || price < LIMITS.minPrice || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(sqft) || sqft <= 0) continue;
    const sqm = sqft * SQM_PER_SQFT;
    if (sqm < LIMITS.minAreaSqm) continue;
    const perSqm = price / sqm;
    if (perSqm < LIMITS.minPerSqm || perSqm > LIMITS.maxPerSqm) continue;
    const key = `${r.block ?? ""}|${price}|${date}|${sqft}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ price, date, perSqm });
  }
  return out;
}

export function parseLatest(rows: Record<string, any>[]): string | null {
  const v = rows[0]?.latest;
  const d = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const LATEST_TTL_MS = 6 * 3600 * 1000;
let latestCache: { date: string; at: number } | null = null;
export function clearLatestCache(): void {
  latestCache = null;
}

async function datasetLatest(today: Date, fetcher?: Fetcher): Promise<string> {
  if (latestCache && !fetcher && Date.now() - latestCache.at < LATEST_TTL_MS) return latestCache.date;
  const tomorrow = nextDay(today.toISOString().slice(0, 10)); // ignore mistyped future dates in the file
  const rows = await socrataQuery(DOMAIN, DATASET, { select: "max(sale_date) as latest", where: `sale_date < '${tomorrow}T00:00:00'` }, { fetcher, timeoutMs: 25000 });
  const date = parseLatest(rows);
  if (!date) throw new SourceError("The NYC Rolling Calendar Sales dataset returned no latest sale date");
  if (!fetcher) latestCache = { date, at: Date.now() };
  return date;
}

export function describe(type: UsType, place: string, x: { median: number; low: number; high: number }, latest: string): string {
  const what = type === "commercial" ? "Commercial premises (offices, stores, lofts, factories, garages, warehouses)" : "Commercial vacant land";
  return (
    `${what} in ${place} sold for a median of ${fmtMoney(x.median, "USD")} per m²; typical range (10th–90th percentile) ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")} per m². ` +
    `The newest recorded sale in the city's file is ${latest}.`
  );
}

export interface UsCommercialInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}

export interface UsCommercialOptions {
  fetcher?: Fetcher;
  today?: Date;
}

export async function usNycCommercial(input: UsCommercialInput, opts: UsCommercialOptions = {}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "commercial").toLowerCase() as UsType;
  if (!(US_TYPES as readonly string[]).includes(type)) throw new InputError(`property_type must be one of: ${US_TYPES.join(", ")} for the United States`);
  const place = routePlace(input);
  const { requested, applied } = clampMonths(input.months);
  const latest = await datasetLatest(opts.today ?? new Date(), opts.fetcher);
  const window = { from: monthsBack(latest, applied), to: latest };
  const collected = await socrataAll(
    DOMAIN,
    DATASET,
    { select: buildSelect(), where: buildWhere(place, type, window), order: ["sale_date DESC", "sale_price DESC"], limit: MAX_ROWS },
    { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: PAGE_SIZE, timeoutMs: 25000 },
  );
  const sales = parseSales(collected.rows, type);
  const dates = sales.map((s) => s.date).sort();
  const summary = summarise(sales.map((s) => s.perSqm));
  const notes: string[] = [];
  if (requested > applied) notes.push(`The city's file covers the last 12 months only; asked for ${requested}, used ${applied}.`);
  const whole = summary && summary.count >= 5 ? summarise(sales.map((s) => s.price)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: "US", town: input.town ?? null, postcode: place.zip ?? null, property_type: type, months: applied },
    summary,
    currency: "USD",
    unit: "per m²",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of the sale price per m² (${type === "commercial" ? "gross floor area" : "land area"}, converted from square feet) of ` +
      `${type === "commercial" ? "tax class 4 offices, stores, lofts, factories, garages and warehouses" : "commercial vacant land"} recorded by the NYC Department of Finance in the ${applied} months up to its latest recorded sale (${latest}). ` +
      `Sales under $${LIMITS.minPrice.toLocaleString("en-US")}, under $${LIMITS.minPerSqm} per m² or over $${LIMITS.maxPerSqm.toLocaleString("en-US")} per m² are dropped as nominal transfers or data errors; rows of one deal repeated per lot are counted once. ` +
      "Condominium units have no floor area in the file and are not included.",
    describe: (x) => describe(type, place.label, x, latest),
    baseUrl: input.baseUrl,
    extra: {
      area: place.label,
      dataset: { name: INFO.name, id: DATASET, url: INFO.homepage },
      window: { months: applied, from_exclusive: window.from, to: window.to },
      dataset_latest_sale: latest,
      ...(whole ? { median_sale_price: whole.median, sale_price_note: "Median whole sale price of the same sales, in USD (not per m²)." } : {}),
      ...(collected.truncated ? { notes: [...notes, `Result capped at the ${MAX_ROWS.toLocaleString("en-US")} most recent matching sales.`] } : notes.length ? { notes } : {}),
    },
  });
}
