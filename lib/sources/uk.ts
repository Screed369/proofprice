// England & Wales home sales from HM Land Registry Price Paid Data, via its public SPARQL endpoint.
// We fetch recent standard-price sales for a town (optionally a postcode district and property type)
// and return aggregates only. Addresses are never returned.

import { fetchJson, SourceError } from "../http";
import { summarise } from "../stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../answer";

const ENDPOINT = "https://landregistry.data.gov.uk/landregistry/query";

export const UK_PROPERTY_TYPES = ["detached", "semi-detached", "terraced", "flat-maisonette", "any"] as const;
export type UkPropertyType = (typeof UK_PROPERTY_TYPES)[number];

export function buildUkQuery(params: {
  town: string;
  postcodeDistrict?: string;
  propertyType: UkPropertyType;
  fromDate: string; // YYYY-MM-DD
  limit: number;
}): string {
  const town = params.town.trim().toUpperCase().replace(/"/g, "");
  const typeClause =
    params.propertyType === "any" ? "" : `?transx lrppi:propertyType lrcommon:${params.propertyType} .`;
  const district = params.postcodeDistrict?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const districtClause = district
    ? `?addr lrcommon:postcode ?postcode . FILTER(STRSTARTS(?postcode, "${district} "))`
    : "";
  return `
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?amount ?date WHERE {
  VALUES ?town { "${town}"^^xsd:string }
  ?addr lrcommon:town ?town .
  ${districtClause}
  ?transx lrppi:propertyAddress ?addr ;
          lrppi:pricePaid ?amount ;
          lrppi:transactionDate ?date ;
          lrppi:transactionCategory <http://landregistry.data.gov.uk/def/ppi/standardPricePaidTransaction> .
  ${typeClause}
  FILTER (?date >= "${params.fromDate}"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT ${params.limit}`;
}

export function parseUkBindings(json: any): { amount: number; date: string }[] {
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows)) throw new SourceError("Unexpected response from HM Land Registry");
  return rows
    .map((r: any) => ({ amount: Number(r?.amount?.value), date: String(r?.date?.value ?? "").slice(0, 10) }))
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0 && r.date);
}

export async function ukHomeSales(input: {
  town: string;
  postcode_district?: string;
  property_type?: UkPropertyType;
  months?: number;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const months = clamp(input.months ?? 12, 1, 36);
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const fromDate = from.toISOString().slice(0, 10);
  const propertyType = input.property_type ?? "any";
  const query = buildUkQuery({
    town: input.town,
    postcodeDistrict: input.postcode_district,
    propertyType,
    fromDate,
    limit: 5000,
  });
  // GET with output=json: the form proven live against the endpoint on 2026-10-12.
  const json = await fetchJson(
    `${ENDPOINT}?${new URLSearchParams({ query, output: "json" }).toString()}`,
    { headers: { accept: "application/sparql-results+json" } },
    25000,
  );
  const rows = parseUkBindings(json);
  const dates = rows.map((r) => r.date).sort();
  const s = summarise(rows.map((r) => r.amount));
  const where = [input.postcode_district?.toUpperCase(), input.town.toUpperCase()].filter(Boolean).join(", ");
  const typeLabel = propertyType === "any" ? "homes" : propertyType.replace("-", " ") + " homes";
  return buildAnswer({
    sourceId: "gb-hmlr-ppd",
    query: { country: "GB", town: input.town, postcode_district: input.postcode_district ?? null, property_type: propertyType, months },
    summary: s,
    currency: "GBP",
    unit: "per home",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      "Median and 10th–90th percentile of standard-price residential sales (category A) recorded by HM Land Registry in the selected area and period. Repossessions, buy-to-let and transfers to companies (category B) are excluded.",
    describe: (x) =>
      `${capitalise(typeLabel)} in ${where} sold for a median of ${fmtMoney(x.median, "GBP")}; typical range ${fmtMoney(x.low, "GBP")}–${fmtMoney(x.high, "GBP")}.`,
    baseUrl: input.baseUrl,
    extra: rows.length >= 5000 ? { note: "Result capped at the 5,000 most recent sales." } : undefined,
  });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
