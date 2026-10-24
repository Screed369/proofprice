// Qatar home sales from the National Planning Council's "Weekly Real Estates Sales Bulletin" on the Qatar Open Data portal
// (data.gov.qa, OpenDataSoft Explore API v2.1). One row per registered sale. Fields and values checked live on 2026-10-24 through the
// GitHub probe (probes qasales1 to qasales3): 26,719 rows, 8 municipalities, usage 'villas or residential houses' for homes.
// We read only date, place, type, area, price: never the encrypted transaction or parcel ids. The newest registered sale in the
// dataset is 2025-12-31 (Qatar publishes in batches), so the window runs back from the newest sale, not from today, and says so.

import { odsExport, odsQuery } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "www.data.gov.qa";
export const DATASET = "weekly-real-estates-sales-bulletin";

export const INFO: SourceInfo = {
  id: "qa-home-sales",
  country: "QA (Qatar)",
  category: "home sales",
  name: "Weekly Real Estates Sales Bulletin (registered sales)",
  publisher: "National Planning Council, State of Qatar, published on the Qatar Open Data portal",
  what_is_recorded:
    "One row per registered real-estate sale: registration date, municipality, district, property type, usage, land area, price per square metre and total value. " +
    "We read only villas and residential houses and residential buildings; the encrypted transaction and parcel numbers are never read.",
  price_type: "transaction",
  freshness: "Published in batches: the newest registered sale in the file is 31 December 2025. Every answer states the date of the newest sale it uses",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), as stated in the licence field of the Qatar Open Data portal record",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: National Planning Council, State of Qatar, Weekly Real Estates Sales Bulletin, Qatar Open Data (https://www.data.gov.qa). Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). " +
    "Figures are ProofPrice aggregates of the published sale records.",
  homepage: "https://www.data.gov.qa/explore/dataset/weekly-real-estates-sales-bulletin/",
  limits:
    "Villas, houses and residential buildings only (usage 'villas or residential houses'); apartments by the unit, land and commercial property are not read. The price is for the whole plot with its building. " +
    "The data is not current (newest sale 31 December 2025). Place = one of the eight municipalities, or a district name. Aggregates only, never plots or owners.",
};

export const MIN_VALUE = 100_000; // QAR: drops symbolic transfers and zero-value rows
export const MAX_ROWS = 5000;
export const HOME_USAGE = "villas or residential houses";
export const TYPES = ["any", "villa", "building"] as const;
export type QaType = (typeof TYPES)[number];

export const MUNICIPALITIES: Record<string, string> = {
  doha: "Doha Municipality",
  "al rayyan": "Al Rayyan Municipality",
  rayyan: "Al Rayyan Municipality",
  "al wakra": "Al Wakra Municipality",
  wakra: "Al Wakra Municipality",
  "al khor": "Al Khor and Al Thakhira Municipality",
  khor: "Al Khor and Al Thakhira Municipality",
  "al khor and al thakhira": "Al Khor and Al Thakhira Municipality",
  "al thakhira": "Al Khor and Al Thakhira Municipality",
  "umm slal": "Umm Slal Municipality",
  "al daayen": "Al Daayen Municipality",
  daayen: "Al Daayen Municipality",
  "al shamal": "Al Shamal Municipality",
  shamal: "Al Shamal Municipality",
  "al shahniya": "Al Shahniya Municipality",
  shahniya: "Al Shahniya Municipality",
};
export const MUNICIPALITY_LIST = ["Doha", "Al Rayyan", "Al Wakra", "Al Khor and Al Thakhira", "Umm Slal", "Al Daayen", "Al Shamal", "Al Shahniya"];

export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bmunicipality\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A municipality's exact name in the file, or null when the text is not a municipality (then it is treated as a district). */
export function municipalityOf(town: string): string | null {
  return MUNICIPALITIES[norm(town)] ?? null;
}

export function clampMonths(m: number | undefined): number {
  return m === undefined || !Number.isFinite(m) ? 12 : Math.max(1, Math.min(36, Math.round(m)));
}
export function monthsBack(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** ODSQL condition: homes only, a real price, inside the window (from exclusive), optional municipality and type. */
export function buildWhere(o: { from: string; municipality?: string | null; type: QaType }): string {
  const parts = [`usage=${q(HOME_USAGE)}`, `property_value>=${MIN_VALUE}`, `registration_date>date'${o.from}'`];
  if (o.municipality) parts.push(`municipality_name=${q(o.municipality)}`);
  if (o.type === "building") parts.push(`property_type=${q("Residential Building")}`);
  return parts.join(" and ");
}

export const SELECT = ["registration_date", "municipality_name", "district_name", "property_type", "area_square_meters", "price_per_square_meter", "property_value"];

export interface QaSale {
  date: string;
  municipality: string;
  district: string;
  type: string;
  value: number;
  perSqm: number | null;
}

export function parseSales(rows: Record<string, any>[]): QaSale[] {
  const out: QaSale[] = [];
  for (const r of rows) {
    const value = Number(r.property_value);
    const date = typeof r.registration_date === "string" ? r.registration_date.slice(0, 10) : "";
    if (!Number.isFinite(value) || value < MIN_VALUE || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const sqm = Number(r.price_per_square_meter);
    out.push({
      date,
      municipality: String(r.municipality_name ?? ""),
      district: String(r.district_name ?? ""),
      type: String(r.property_type ?? ""),
      value,
      perSqm: Number.isFinite(sqm) && sqm > 0 ? sqm : null,
    });
  }
  return out;
}

export interface QaInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}
export interface QaOptions {
  fetcher?: Fetcher;
}

export async function qaHomeSales(input: QaInput, opts: QaOptions = {}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as QaType;
  if (!(TYPES as readonly string[]).includes(type)) throw new InputError(`property_type must be one of: ${TYPES.join(", ")} for Qatar (villa = villas and houses, building = whole residential buildings).`);
  if (input.postcode && String(input.postcode).trim()) throw new InputError("Qatar sales have no postcode: give a municipality (e.g. Doha, Al Rayyan) or a district name as town, or leave town out for all of Qatar.");
  const months = clampMonths(input.months);
  const town = input.town?.trim() || "";
  const municipality = town ? municipalityOf(town) : null;

  // newest registered home sale in the file
  const newestRows = await odsQuery(DOMAIN, DATASET, { select: ["registration_date"], where: `usage=${q(HOME_USAGE)} and property_value>=${MIN_VALUE}`, orderBy: "registration_date desc", limit: 1 }, { fetcher: opts.fetcher, timeoutMs: 25000 });
  const newest = typeof newestRows.results[0]?.registration_date === "string" ? newestRows.results[0].registration_date.slice(0, 10) : null;
  if (!newest) throw new SourceError("The Qatar sales bulletin returned no recent home sales");
  const from = monthsBack(newest, months);

  const got = await odsExport(
    DOMAIN,
    DATASET,
    { select: SELECT, where: buildWhere({ from, municipality, type }), orderBy: "registration_date desc", limit: MAX_ROWS },
    { fetcher: opts.fetcher, timeoutMs: 30000, maxRows: MAX_ROWS },
  );
  let sales = parseSales(got.rows);
  if (type === "villa") sales = sales.filter((s) => /villa|house/i.test(s.type));
  if (town && !municipality) {
    const want = norm(town);
    sales = sales.filter((s) => norm(s.district) === want);
  }
  const dates = sales.map((s) => s.date).sort();
  const summary = summarise(sales.map((s) => s.value));
  const sqm = summarise(sales.flatMap((s) => (s.perSqm ? [s.perSqm] : [])));
  const where = town ? (municipality ? municipality.replace(/ Municipality$/, "") : town) : "Qatar";
  const noun = type === "villa" ? "Villas and houses" : type === "building" ? "Residential buildings" : "Villas, houses and residential buildings";
  const truncated = got.truncated;

  return buildAnswer({
    source: INFO,
    query: { country: "QA", town: town || null, property_type: type, months },
    summary,
    currency: "QAR",
    unit: "per property sold (plot with its building)",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of registered sale values (QAR) of ${noun.toLowerCase()} in ${where} in the ${months} months up to the newest sale in the bulletin (${newest}). ` +
      `Sales under QAR ${MIN_VALUE.toLocaleString("en-US")} are dropped. The value is for the whole plot with its building. ` +
      "The bulletin is published in batches and its newest sale is from 2025, so this is not today's market." +
      (truncated ? ` Only the ${MAX_ROWS.toLocaleString("en-US")} most recent sales are used; ask for fewer months or a municipality for the full window.` : ""),
    describe: (x) =>
      `${noun} in ${where} sold for a median of ${fmtMoney(x.median, "QAR")}; 10th–90th percentile range ${fmtMoney(x.low, "QAR")}–${fmtMoney(x.high, "QAR")}. ` +
      `The newest sale in the bulletin is ${newest}.`,
    baseUrl: input.baseUrl,
    extra: {
      area: where,
      window: { months, from_exclusive: from, to: newest },
      dataset_latest_sale: newest,
      price_per_square_metre_of_land_qar: sqm ? { median: sqm.median, p10: sqm.low, p90: sqm.high, n: sqm.count } : null,
      municipalities: MUNICIPALITY_LIST,
      notes: ["Qatar publishes this bulletin in batches; the newest registered sale is older than the date of this answer."],
    },
  });
}
