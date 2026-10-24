// US federal hourly labour CEILING rates from GSA CALC+ (U.S. General Services Administration, Technology Transformation Services).
// API facts (probed from GitHub Actions 2026-10-24, probes plb-gsa-calc1..4; docs https://open.gsa.gov/api/dx-calc-api/ read the same day):
//   GET https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/?keyword=<text>&page=1&page_size=1   key-free, JSON, x-ratelimit-limit 1000 per hour
//   keyword searches labor_category, vendor_name and idv_piid; filter=sin:<code> narrows to a GSA schedule SIN.
//   Every response carries aggregations over the WHOLE match: wage_stats.count, histogram_percentiles.values["10.0"|"50.0"|"90.0"]
//   (approximate percentiles of current_price, USD per hour), so one page_size=1 call gives the range. Index is rebuilt nightly (index ceilingrates-YYYY-MM-DD_HH-MM-SS).
// These are CEILING rates (the most a contractor may charge on its GSA schedule contract), not prices paid: every answer says so.
import { buildAnswer, fmtMoney, type PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import type { PriceSummary } from "../../lib/stats";
import { laborKeyword } from "../../categories/contracts/labor";

export const INFO: SourceInfo = {
  id: "us-gsa-calc",
  country: "US (federal contract labour rates)",
  category: "government contracts (hourly labour ceiling rates)",
  name: "GSA CALC+: contract-awarded labour category ceiling rates",
  publisher: "U.S. General Services Administration, Technology Transformation Services (CALC+)",
  what_is_recorded:
    "Hourly CEILING rates (US dollars per hour) that contractors have agreed with GSA for each labour category on their Multiple Award Schedule and other GSA contracts: labour category, education, years of experience, worksite, business size, schedule and SIN.",
  price_type: "posted_price",
  freshness: "Rebuilt every night by GSA",
  licence:
    "CC0 1.0 Universal (public domain dedication): data.gov record 'Contract-Awarded Labor Category API' lists the licence as https://creativecommons.org/publicdomain/zero/1.0/ " +
    "(publisher GSA Technology Transformation Services; access level public), read 23 Oct 2026. Commercial reuse allowed, no attribution required.",
  licence_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution:
    "Source: GSA CALC+ (Contract-Awarded Labor Category), U.S. General Services Administration. Ceiling hourly rates, not prices paid. ProofPrice is not endorsed by GSA.",
  homepage: "https://buy.gsa.gov/pricing/",
  limits:
    "Ceiling (maximum) hourly rates written into federal schedule contracts, NOT what agencies actually paid: orders can be negotiated lower. One line per labour category per contract, so a contractor with many categories counts many times; " +
    "the keyword also matches vendor names and contract numbers. Percentiles are computed by GSA's search index and are approximate. Federal schedule contracts only. Contractors are never named.",
};

export const BASE = "https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/";

export interface CalcSummary {
  count: number;
  low: number;
  median: number;
  high: number;
  min: number;
  max: number;
  /** YYYY-MM-DD of the nightly index the figures come from. */
  indexDate: string | null;
}

/** "sin:541330ENG" or "calc:541330ENG" -> "541330ENG"; null when it is not one. */
export function sinFilter(cpv: string | undefined): string | null {
  const m = /^(?:sin|calc):\s*([A-Za-z0-9]{3,12})$/i.exec((cpv ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

export function buildUrl(keyword: string, sin: string | null): string {
  const q = new URLSearchParams({ page: "1", page_size: "1" });
  if (keyword) q.set("keyword", keyword);
  if (sin) q.append("filter", `sin:${sin}`);
  return `${BASE}?${q.toString()}`;
}

/** Reads the aggregations GSA returns with every call. Null when nothing matched. Throws SourceError when the shape is not the one we know. */
export function parseCalc(json: any): CalcSummary | null {
  const total = Number(json?.hits?.total?.value);
  const stats = json?.aggregations?.wage_stats;
  const pct = json?.aggregations?.histogram_percentiles?.values;
  if (!Number.isFinite(total) || !stats || !pct) throw new SourceError("GSA CALC+ answered in a format we do not recognise", "missing hits.total / wage_stats / histogram_percentiles");
  const count = Number(stats.count);
  if (!(count > 0) || pct["50.0"] == null) return null;
  const low = Number(pct["10.0"]);
  const median = Number(pct["50.0"]);
  const high = Number(pct["90.0"]);
  const min = Number(stats.min);
  const max = Number(stats.max);
  if (![low, median, high, min, max].every(Number.isFinite)) throw new SourceError("GSA CALC+ answered with unreadable rates", "non-numeric percentiles");
  const idx = /ceilingrates-(\d{4}-\d{2}-\d{2})/.exec(String(json?.hits?.hits?.[0]?._index ?? ""));
  return { count, low, median, high, min, max, indexDate: idx ? idx[1] : null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CalcInput {
  what: string;
  cpv?: string;
  baseUrl?: string;
}

export async function usLaborRates(input: CalcInput): Promise<PriceAnswer> {
  const sin = sinFilter(input.cpv);
  if (input.cpv && !sin) throw new InputError("For US labour rates, cpv must be a GSA schedule SIN as 'sin:541330ENG'.");
  const keyword = laborKeyword(input.what);
  if (!keyword && !sin) throw new InputError("Give a labour category, for example 'software engineer hourly rate' or 'project manager hourly rate'.");
  if (keyword && keyword.length < 2) throw new InputError("Give a labour category of at least two letters, for example 'electrician hourly rate'.");
  const json = await fetchJson(buildUrl(keyword, sin));
  const s = parseCalc(json);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = s?.indexDate ?? today;
  const label = keyword || `SIN ${sin}`;
  const summary: PriceSummary | null = s
    ? { count: s.count, median: r2(s.median), low: r2(s.low), high: r2(s.high), min: r2(s.min), max: r2(s.max) }
    : null;
  return buildAnswer({
    source: INFO,
    query: { country: "US", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "USD",
    unit: "per hour, ceiling rate",
    period: { from: asOf, to: asOf },
    method:
      `GSA CALC+ labour-category lines whose labour category, vendor or contract number contains "${keyword || "(any)"}"` +
      (sin ? ` on schedule SIN ${sin}` : "") +
      `, from the nightly index of ${asOf}. Each line is the current hourly CEILING rate in US dollars that a contractor may charge federal buyers for one labour category on one contract. ` +
      "Median and 10th–90th percentile of those rates as computed by GSA's search index (approximate). Ceiling rates are not prices paid; one line per category per contract; contractors are never named.",
    describe: (x: PriceSummary) =>
      `US federal schedule contracts set a median ceiling rate of ${fmtMoney(x.median, "USD")} per hour for "${label}" ` +
      `(typical range ${fmtMoney(x.low, "USD")} to ${fmtMoney(x.high, "USD")}, 10th to 90th percentile). ` +
      "These are ceiling (maximum) hourly rates written into GSA contracts, not what agencies actually paid.",
    baseUrl: input.baseUrl,
    published: asOf,
    evidence: {
      label: "Ceiling hourly rate",
      meaning: "The most a contractor may charge federal buyers per hour for this labour category under its GSA contract. Actual orders can be lower. Not a price paid.",
    },
    extra: {
      rate_basis: "ceiling",
      rate_lines: s?.count ?? 0,
      matched_keyword: keyword || null,
      ...(sin ? { sin } : {}),
      value_basis: "hourly ceiling rate per labour category per contract; not a price paid",
    },
  });
}
