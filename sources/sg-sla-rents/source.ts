// Singapore: rents awarded on state-owned land and buildings, from the Singapore Land Authority's "Rental Tender and Bidding Results Information" on data.gov.sg.
// Format checked live on 2026-10-29 through the GitHub probe: plain GET, no key, datastore_search on resource d_2057d332317dd0d045e392fe4e9aca57
// (589 rows, one request; fields year, property_location, mode_of_allocation, tendered_uses, tenure, award_date, awarded_usage,
// award_value_per_month_for_the_first_term_tenancy, successful_bidder, _id). Amounts are TEXT: plain digits in the older rows, "58,000" with a
// thousands comma in the newer ones, and "No Award", "No Bidders", "No Bid", "(A) (B)" multi-parcel or "(initial period)" texts that are not one rent.
// We never read or show successful_bidder (a company name). Aggregates only: at least 5 awards per answer.

import { ckanSearch } from "../../lib/adapters";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";

export const RESOURCE_ID = "d_2057d332317dd0d045e392fe4e9aca57";
export const SITE = "https://data.gov.sg/api/action";

export const INFO: SourceInfo = {
  id: "sg-sla-rents",
  country: "SG (Singapore)",
  category: "state property rents (SLA tender and allocation results)",
  name: "Rental tender and bidding results information",
  publisher: "Singapore Land Authority (SLA), published on data.gov.sg",
  what_is_recorded:
    "For each state-owned site let by the Singapore Land Authority: year, location, how it was allocated (tender, direct allocation, auction), the permitted uses, the lease term, and the monthly rent awarded for the first lease term.",
  price_type: "contract_price",
  freshness: "Updated when SLA publishes new results (the file read 29 Oct 2026 ran to award year 2025)",
  licence: "Singapore Open Data Licence v1.0 (worldwide, perpetual, royalty-free use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Rental Tender and Bidding Results Information accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  homepage: "https://data.gov.sg/dataset/sla-rental-tender-and-bidding-results-information",
  limits:
    "Rents awarded for the first lease term of state-owned sites (plots, buildings, hostels, childcare centres, nurseries, storage and the like), mixed in size and use, so wide ranges are normal. Winning bids and allocation rents, not market rents and not home rents. Awards with no bid, no award, or several parcels in one text are left out. The winning bidder is never shown. Aggregates only: at least 5 awards per answer.",
};

export type Allocation = "tender" | "direct" | "auction";

export interface Award {
  year: number;
  allocation: Allocation | "other";
  uses: string; // lower-case permitted uses + awarded usage
  rent: number; // SGD per month, first lease term
}

export interface ParsedAwards {
  awards: Award[];
  /** Rows of the file, and rows left out because they carry no single numeric rent (no bid, no award, several parcels). */
  rows: number;
  without_rent: number;
}

/** Pure: "58,000" -> 58000; "28288" -> 28288; "No Award", "2500000 (initial period)", "71336.04 (A) 99000 (C)" -> null. */
export function parseRent(text: unknown): number | null {
  const s = String(text ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function allocationOf(text: unknown): Award["allocation"] {
  const s = String(text ?? "").trim().toLowerCase();
  if (s.startsWith("rent direct") || s.includes("direct")) return "direct";
  if (s.startsWith("auction")) return "auction";
  if (s.startsWith("tender") || s.startsWith("limited tender") || s.includes("bidding") || s.includes("e-bid")) return "tender";
  return "other";
}

/** Pure: turn datastore records into awards. A row without a plausible year or a single numeric rent is counted but dropped. Needs the file to look right. */
export function parseAwards(records: Record<string, any>[]): ParsedAwards {
  const awards: Award[] = [];
  let without = 0;
  for (const r of records) {
    const year = Number(String(r?.year ?? "").trim());
    const rent = parseRent(r?.award_value_per_month_for_the_first_term_tenancy);
    if (!Number.isInteger(year) || year < 1990 || year > 2100 || rent === null || rent < 100 || rent > 20_000_000) {
      without++;
      continue;
    }
    awards.push({
      year,
      allocation: allocationOf(r?.mode_of_allocation),
      uses: `${String(r?.tendered_uses ?? "")} ${String(r?.awarded_usage ?? "")}`.toLowerCase().replace(/\s+/g, " ").trim(),
      rent,
    });
  }
  if (records.length < 100 || awards.length < 50) throw new SourceError("The SLA rental results file has far fewer usable rows than expected; this source needs updating.");
  return { awards, rows: records.length, without_rent: without };
}

export interface SlaInput {
  use?: string;
  allocation?: string;
  years?: number;
  baseUrl?: string;
}

const METHOD =
  "Median and 10th-90th percentile of the monthly rent awarded for the first lease term in Singapore Land Authority rental tender, direct-allocation and auction results, " +
  "for the chosen tendered use, allocation mode and award years. Contract rents from award results, not market rents; awards with no bid, no award or several parcels in one amount are left out; the winning bidder is never shown.";

/** Pure: answer a request from the parsed awards. */
export function answerFromAwards(parsed: ParsedAwards, input: SlaInput): PriceAnswer {
  const use = input.use?.trim().toLowerCase();
  if (input.use !== undefined && (!use || use.length < 2)) throw new InputError("use must be a word such as childcare, hostel, school, storage, nursery or office.");
  const allocation = input.allocation?.trim().toLowerCase();
  if (allocation && !["tender", "direct", "auction"].includes(allocation)) throw new InputError('allocation must be "tender", "direct" or "auction".');
  const years = input.years === undefined ? 10 : Math.round(input.years);
  if (!Number.isFinite(years) || years < 1 || years > 25) throw new InputError("years must be a whole number from 1 to 25, e.g. 10.");

  const newest = parsed.awards.reduce((m, a) => Math.max(m, a.year), 0);
  const fromYear = newest - years + 1;
  const picked = parsed.awards.filter(
    (a) => a.year >= fromYear && (!allocation || a.allocation === allocation) && (!use || a.uses.includes(use)),
  );
  const s = summarise(picked.map((a) => a.rent));
  const ys = picked.map((a) => a.year);
  const from = ys.length ? String(Math.min(...ys)) : String(fromYear);
  const to = ys.length ? String(Math.max(...ys)) : String(newest);
  const label =
    `${allocation ? (allocation === "direct" ? "direct allocations" : allocation + "s") : "tenders, allocations and auctions"} of Singapore state land and buildings` +
    (use ? ` with "${use}" among the tendered uses` : "");

  const byAllocation: Record<string, number> = {};
  for (const a of picked) byAllocation[a.allocation] = (byAllocation[a.allocation] ?? 0) + 1;

  return buildAnswer({
    source: INFO,
    query: { country: "SG", use: use ?? null, allocation: allocation ?? null, years },
    summary: s,
    currency: "SGD",
    unit: "per month (first lease term)",
    period: { from, to },
    method: METHOD,
    describe: (x) =>
      `The rent awarded in ${label}, award years ${from}-${to}, had a median of ${fmtMoney(x.median, "SGD")} a month for the first lease term; 10th-90th percentile range ${fmtMoney(x.low, "SGD")}-${fmtMoney(x.high, "SGD")}. ` +
      "These are contract rents from Singapore Land Authority award results for state land and buildings of very different sizes and uses, not market rents and not home rents.",
    baseUrl: input.baseUrl,
    extra: {
      awards_by_allocation: byAllocation,
      newest_award_year_in_file: newest,
      rows_without_a_single_rent: parsed.without_rent,
      caveat: "Winning-bid and allocation rents for the first lease term of state-owned sites, mixed in size and use. Awards with no bid or no award are not counted. The winning bidder is not shown.",
    },
  });
}

export async function sgSlaRents(input: SlaInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 1000 })).records;
  return answerFromAwards(parseAwards(records), input);
}
