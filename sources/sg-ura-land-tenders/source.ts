// Singapore: land sold by tender (Government Land Sales), from "Government Land Sales - Sale of State Land by Tender" published by the
// Urban Redevelopment Authority (URA) on data.gov.sg. Format checked live on 2026-10-30 through the GitHub probe: plain GET, no key,
// datastore_search on resource d_e225b635fbe3ecf5b378447e4b517939 (340 records, awards 1992-08-31 to 2016-07-01, last updated 2024-06-06).
// Every value is TEXT ("15936.1", "na" for a missing number). We never read or show successful_tenderer_name (a company name).
// Aggregates only: at least 5 sites per answer.

import { ckanSearch } from "../../lib/adapters";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";

export const RESOURCE_ID = "d_e225b635fbe3ecf5b378447e4b517939";
export const SITE = "https://data.gov.sg/api/action";

export const INFO: SourceInfo = {
  id: "sg-ura-land-tenders",
  country: "SG (Singapore)",
  category: "land sold by tender (Government Land Sales)",
  name: "Government Land Sales: sale of state land by tender (results of awarded tenders)",
  publisher: "Urban Redevelopment Authority (URA), published on data.gov.sg",
  what_is_recorded:
    "Each state-land site sold by public tender in Singapore: award date, location, planning area, the development allowed, the lease length, the site area and gross floor area, the number of bids, and the winning tender price (total and per m² of gross floor area).",
  price_type: "transaction",
  freshness: "A historic file: awards from 1992 to mid-2016 only, last updated by the publisher on 6 June 2024. Every answer states its period",
  licence: "Singapore Open Data Licence v1.0 (worldwide, perpetual, royalty-free use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Government Land Sales - Sale of State Land by Tender accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  homepage: "https://data.gov.sg/",
  limits:
    "Winning tender prices for state-owned development sites (not homes and not private land sales), with very different sizes and permitted developments, so wide ranges are normal. The price is per m² of gross floor area (GFA) that the site allows, the way Singapore quotes land prices, not per m² of ground. Awards stop in mid-2016. The winning tenderer is never shown. Aggregates only: at least 5 sites per answer.",
};

export interface Site {
  date: string; // award date, ISO
  area: string; // planning area, as published ("Bedok")
  development: string; // type_of_devt_code, e.g. "Residential (Non-Landed)"
  price: number; // SGD, total winning tender price
  psm: number; // SGD per m² of gross floor area
  siteArea: number | null; // m²
}

export interface ParsedSites {
  sites: Site[];
  rows: number;
  dropped: number;
}

/** Pure: "15936.1" -> 15936.1; "na", "", "-" -> null. Thousands commas are tolerated. */
export function parseNum(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Pure: turn datastore records into sites. A row without an award date, a planning area or a positive price per m² is counted but dropped. */
export function parseSites(records: Record<string, any>[]): ParsedSites {
  const sites: Site[] = [];
  let dropped = 0;
  for (const r of records) {
    const date = String(r?.date_of_award ?? "").trim();
    const price = parseNum(r?.successful_tender_price);
    const gfa = parseNum(r?.gross_floor_area);
    let psm = parseNum(r?.psm_per_gpr_or_gfa);
    if (psm === null && price !== null && gfa !== null && gfa > 0) psm = price / gfa;
    const area = String(r?.planning_area ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || price === null || price <= 0 || psm === null || psm < 50 || psm > 200_000 || !area) {
      dropped++;
      continue;
    }
    sites.push({
      date,
      area,
      development: String(r?.type_of_devt_code ?? r?.type_of_devt_allowed ?? "").trim(),
      price,
      psm,
      siteArea: parseNum(r?.site_area),
    });
  }
  if (records.length < 100 || sites.length < 100) throw new SourceError("The URA land-tender file has far fewer usable rows than expected; this source needs updating.");
  return { sites, rows: records.length, dropped };
}

export interface SgLandInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const METHOD =
  "Median and 10th-90th percentile of the winning tender price per m² of gross floor area, over Singapore state-land sites sold by public tender (URA Government Land Sales results), " +
  "for the chosen planning area and award years. Winning bids from awarded tenders; the winning tenderer is never shown.";

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Pure: answer a request from the parsed sites. */
export function answerFromSites(parsed: ParsedSites, input: SgLandInput): PriceAnswer {
  if (input.postcode !== undefined && input.postcode.trim() !== "") {
    throw new InputError("Singapore: postcodes are not supported for land sales; give the URA planning area as town (e.g. Bedok, Queenstown, River Valley), or leave town out for all of Singapore.");
  }
  const type = input.property_type?.trim().toLowerCase();
  if (type && type !== "land") {
    throw new InputError('Singapore: only property_type "land" is available here (state-land sites sold by tender); leave property_type out or use "land".');
  }
  let months: number | null = null;
  if (input.months !== undefined) {
    months = Math.round(input.months);
    if (!Number.isFinite(months) || months < 1 || months > 400) throw new InputError("months must be a whole number from 1 to 400, e.g. 120.");
  }
  const town = input.town?.trim();
  if (input.town !== undefined && town!.length < 2) throw new InputError("town must be a Singapore planning area such as Bedok, Queenstown or River Valley.");

  const newest = parsed.sites.reduce((m, s) => (s.date > m ? s.date : m), "0000-00-00");
  const oldest = parsed.sites.reduce((m, s) => (s.date < m ? s.date : m), "9999-99-99");
  const windowStart = months === null ? null : addMonths(newest, months);
  const areas = [...new Set(parsed.sites.map((s) => s.area))].sort();
  const want = town ? norm(town) : null;
  const picked = parsed.sites.filter((s) => (want === null || norm(s.area) === want) && (windowStart === null || s.date > windowStart));
  const summary = summarise(picked.map((s) => s.psm));
  const dates = picked.map((s) => s.date).sort();
  const from = dates.length ? dates[0] : windowStart ?? oldest;
  const to = dates.length ? dates[dates.length - 1] : newest;

  const byDevelopment: Record<string, number> = {};
  for (const s of picked) byDevelopment[s.development || "other"] = (byDevelopment[s.development || "other"] ?? 0) + 1;

  const where = want === null ? "all of Singapore" : `the ${picked[0]?.area ?? town} planning area`;
  return buildAnswer({
    source: INFO,
    query: { country: "SG", town: town ?? null, property_type: "land", months },
    summary,
    currency: "SGD",
    unit: "per m² of gross floor area allowed",
    period: { from, to },
    method: METHOD,
    describe: (x) =>
      `State-land sites sold by public tender in ${where}, awarded ${from} to ${to}, had a median winning price of ${fmtMoney(x.median, "SGD")} per m² of gross floor area; 10th-90th percentile range ${fmtMoney(x.low, "SGD")}-${fmtMoney(x.high, "SGD")}. ` +
      "These are winning bids on government-owned development sites of very different sizes and uses, not homes and not private land deals. The file ends in mid-2016.",
    baseUrl: input.baseUrl,
    extra: {
      sites_by_development: byDevelopment,
      newest_award_in_file: newest,
      oldest_award_in_file: oldest,
      planning_areas_available: areas,
      rows_dropped_without_price: parsed.dropped,
      caveat: "Historic file: awards 1992 to mid-2016. Price per m² of gross floor area allowed on the site (Singapore's usual land-price measure), not per m² of ground. The winning tenderer is not shown.",
    },
  });
}

export async function sgLandTenders(input: SgLandInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 1000 })).records;
  return answerFromSites(parseSites(records), input);
}
