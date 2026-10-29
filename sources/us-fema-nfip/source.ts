// US flood insurance (FEMA OpenFEMA, NFIP Redacted Policies v3). Key-free OData API. Format checked live on 2026-10-17 through the Probe workflow.
// GET https://www.fema.gov/api/open/v3/NfipPolicies?$filter=reportedZipCode eq '32935' and policyEffectiveDate ge '2025-10-17'&$select=...&$top=1000&$count=true
//   -> { metadata: { count: 908, ... }, NfipPolicies: [ { policyCost, totalInsurancePremiumOfThePolicy, policyCount, policyTermIndicator, occupancyType,
//        policyEffectiveDate, reportedZipCode, propertyState, asOfDate, federalPolicyFee, hfiaaSurcharge, reserveFundAssessment, ... } ] }
// policyCost = premium + federal policy fee + HFIAA surcharge + reserve fund assessment (what the policyholder is charged for the year).
// Privacy: the rows carry ZIP, census tract and dates, so rows are only ever summarised here; nothing per policy leaves this file, and under 5 policies gives no figure.

import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "us-fema-nfip",
  country: "US",
  category: "insurance (flood, NFIP)",
  name: "OpenFEMA NFIP Redacted Policies v3",
  publisher: "Federal Emergency Management Agency (FEMA), OpenFEMA",
  what_is_recorded:
    "One row per National Flood Insurance Program policy transaction: the premium, the federal fees and surcharges, the policy cost to the holder, the building coverage, the policy term, " +
    "the ZIP code, state and effective date. Personal details are removed by FEMA.",
  price_type: "transaction",
  freshness: "Updated about monthly (data as of 2026-09-08 when checked); every answer states the period it covers",
  licence: "U.S. Government Works (public domain). OpenFEMA asks users to cite OpenFEMA and says the data is not an official federal report.",
  licence_url: "https://www.usa.gov/government-works",
  attribution: "Source: FEMA OpenFEMA, NFIP Redacted Policies v3 (fema.gov/about/openfema). This is not an official FEMA or federal report.",
  homepage: "https://www.fema.gov/openfema-data-page/fima-nfip-redacted-policies-v2",
  limits:
    "Flood insurance from the National Flood Insurance Program only: private flood cover and homeowners policies are not included. NFIP rates are set partly by federal rules, " +
    "so these are real charges but not free-market quotes. The charge depends on the flood zone, the building and the coverage chosen, which this answer does not split. " +
    "A ZIP or state with more than 1,000 policies in the period is summarised from a systematic sample of the records, and the answer says so. Fewer than 5 policies gives no figure.",
};

export const API = "https://www.fema.gov/api/open/v3/NfipPolicies";
export const FIELDS = ["policyCost", "totalInsurancePremiumOfThePolicy", "policyCount", "policyTermIndicator", "policyEffectiveDate", "asOfDate", "occupancyType"];
const PAGE = 1000;
const STATE_PAGES = 4; // 1 first page + up to 3 systematic pages for big areas

export interface Policy {
  cost: number; // policyCost: premium plus fees and surcharges, per year
  premium: number | null; // totalInsurancePremiumOfThePolicy
  effective: string | null; // YYYY-MM-DD
  asOf: string | null;
}

export const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" "),
);

export type Area = { kind: "zip"; value: string; field: "reportedZipCode" } | { kind: "state"; value: string; field: "propertyState" };

/** 5-digit ZIP (a ZIP+4 is cut to 5) or a 2-letter state/territory code. Anything else is the caller's mistake. */
export function parseArea(raw: string | undefined): Area {
  const t = (raw ?? "").trim();
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(t);
  if (zip) return { kind: "zip", value: zip[1], field: "reportedZipCode" };
  const st = t.toUpperCase();
  if (/^[A-Z]{2}$/.test(st)) {
    if (!US_STATES.has(st)) throw new InputError(`'${t}' is not a US state or territory code. Give a state such as 'TX' or a 5-digit ZIP code such as '32935'.`);
    return { kind: "state", value: st, field: "propertyState" };
  }
  throw new InputError("area is required: a 5-digit ZIP code such as '32935' or a state code such as 'TX'.");
}

const DAY_SAMPLES = 8;

export function windowStart(now: Date = new Date(), months = 12): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export function buildUrl(area: Area, from: string, opts: { top?: number; skip?: number; count?: boolean; until?: string } = {}): string {
  const filter = `${area.field} eq '${area.value}' and policyEffectiveDate ge '${from}'` + (opts.until ? ` and policyEffectiveDate lt '${opts.until}'` : "");
  const q = [
    `$filter=${encodeURIComponent(filter)}`,
    `$select=${FIELDS.join(",")}`,
    `$top=${opts.top ?? PAGE}`,
  ];
  if (opts.skip) q.push(`$skip=${opts.skip}`);
  if (opts.count) q.push("$count=true");
  return `${API}?${q.join("&")}`;
}

const day = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Annual, single-policy rows with a positive charge that started on or before the file's as-of date. Multi-policy rows (policyCount > 1) and multi-year terms would distort a per-year price, so they are dropped. */
export function parsePolicies(body: any): Policy[] {
  const rows: any[] = Array.isArray(body?.NfipPolicies) ? body.NfipPolicies : [];
  const out: Policy[] = [];
  for (const r of rows) {
    const cost = Number(r?.policyCost);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    if (r.policyCount !== undefined && r.policyCount !== null && Number(r.policyCount) !== 1) continue;
    if (r.policyTermIndicator !== undefined && r.policyTermIndicator !== null && Number(r.policyTermIndicator) !== 1) continue;
    const prem = Number(r.totalInsurancePremiumOfThePolicy);
    // The file also holds renewals dated after its own as-of date: a charge that has not started yet is not a price paid.
    if (day(r.policyEffectiveDate) && day(r.asOfDate) && day(r.policyEffectiveDate)! > day(r.asOfDate)!) continue;
    out.push({ cost, premium: Number.isFinite(prem) && prem > 0 ? prem : null, effective: day(r.policyEffectiveDate), asOf: day(r.asOfDate) });
  }
  return out;
}

export function totalCount(body: any): number {
  const n = Number(body?.metadata?.count);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Skips for the extra pages: evenly spread over the whole result so the sample is not just the first rows.
 *  No longer used for answers (FEMA's backend times out on deep $skip values, e.g. $skip=165801 in Texas); kept for reference and tests. */
export function sampleSkips(count: number, pages = STATE_PAGES - 1): number[] {
  if (count <= PAGE) return [];
  const span = count - PAGE;
  return Array.from({ length: pages }, (_, i) => Math.floor(((i + 1) * span) / pages));
}

const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** The window [from, to] cut into `n` consecutive date slices [from, until). FEMA answers ZIP queries with a bounded date range but returns
 *  503 or times out for an open-ended one (probed 18 Oct 2026), so every call here carries both bounds. */
export function quarterSlices(from: string, to: string, n = 4): { from: string; until: string }[] {
  const end = addDays(to, 1);
  const days = Math.max(n, Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000));
  return Array.from({ length: n }, (_, i) => ({
    from: addDays(from, Math.floor((i * days) / n)),
    until: i === n - 1 ? end : addDays(from, Math.floor(((i + 1) * days) / n)),
  }));
}

/** For a slice that holds more than one page of policies: a narrow sub-slice in its middle sized to hold about 800 policies, so a big
 *  state is read from a few narrow slices (fast) and never with deep $skip paging (times out). Returns the slice itself when it fits one page. */
export function narrowSlice(sl: { from: string; until: string }, count: number): { from: string; until: string } {
  if (count <= PAGE) return sl;
  const days = Math.max(1, Math.round((Date.parse(sl.until + "T00:00:00Z") - Date.parse(sl.from + "T00:00:00Z")) / 86400000));
  const width = Math.min(days, Math.max(1, Math.floor((days * 800) / count)));
  const start = Math.floor((days - width) / 2);
  return { from: addDays(sl.from, start), until: addDays(sl.from, start + width) };
}

export function summarisePolicies(policies: Policy[]) {
  const cost = summarise(policies.map((p) => p.cost));
  const premiums = summarise(policies.map((p) => p.premium ?? NaN));
  const dates = policies.map((p) => p.effective).filter((d): d is string => !!d).sort();
  const asOf = policies.map((p) => p.asOf).filter((d): d is string => !!d).sort().pop() ?? null;
  return { cost, premium: premiums, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, asOf };
}

export async function femaNfip(opts: { area?: string; baseUrl?: string; now?: Date; fetcher?: (url: string) => Promise<any> }): Promise<PriceAnswer> {
  const area = parseArea(opts.area);
  const from = windowStart(opts.now);
  // FEMA sometimes stalls on a single call: two attempts of 12 s fit the 40 s answer deadline for one round (see lib/http retryOnce).
  const get = opts.fetcher ?? ((u: string) => retryOnce(() => fetchJson(u, {}, 12000)));
  const to = (opts.now ?? new Date()).toISOString().slice(0, 10);
  let pages: any[];
  let counts: number[];
  let total: number;
  let sampled: boolean;
  let estimated = false;
  if (area.kind === "state") {
    // A whole quarter of a big state (TX: ~500k policies a year) times out even with $count. Ask instead for single-day windows spread evenly
    // over the 12 months (each ~1,000 to 1,500 policies, fast), and estimate the year's total from their average daily count.
    const days = DAY_SAMPLES;
    const span = Math.max(days, Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000));
    const wins = Array.from({ length: days }, (_, i) => { const d = addDays(from, Math.floor(((i + 0.5) * span) / days)); return { from: d, until: addDays(d, 1) }; });
    pages = await Promise.all(wins.map((w) => get(buildUrl(area, w.from, { until: w.until, count: true }))));
    counts = pages.map((b) => totalCount(b));
    total = Math.round((counts.reduce((x, y) => x + y, 0) / days) * span);
    sampled = true;
    estimated = true;
  } else {
    const quarters = quarterSlices(from, to);
    // Round 1: one bounded request per quarter, with the count. A quarter that fits one page (every ZIP, normally) is already complete.
    const counted = await Promise.all(quarters.map(async (sl) => ({ sl, body: await get(buildUrl(area, sl.from, { until: sl.until, count: true })) })));
    counts = counted.map((c) => totalCount(c.body));
    total = counts.reduce((x, y) => x + y, 0);
    sampled = counts.some((c) => c > PAGE);
    // Round 2, big areas only: replace a quarter's first page (just the first rows FEMA returns) with one narrow slice from its middle.
    pages = await Promise.all(
      counted.map((c, i) => {
        if (counts[i] <= PAGE) return Promise.resolve(c.body);
        const sl = narrowSlice(c.sl, counts[i]);
        return get(buildUrl(area, sl.from, { until: sl.until }));
      }),
    );
  }
  let policies: Policy[] = [];
  for (const b of pages) if (b) policies = policies.concat(parsePolicies(b));
  if (total > 0 && pages.some((b) => b && !Array.isArray(b?.NfipPolicies))) throw new SourceError("The source answered in an unexpected format", "NfipPolicies missing");
  const s = summarisePolicies(policies);
  const label = area.kind === "zip" ? `ZIP code ${area.value}` : `${area.value} (state)`;
  const enough = s.cost && s.cost.count >= MIN_PUBLISH;
  return buildAnswer({
    source: INFO,
    query: { country: "US", area: area.value },
    summary: s.cost,
    currency: "USD",
    unit: "per policy per year",
    period: { from: s.from ?? from, to: s.to ?? null },
    method:
      "Flood insurance charges of National Flood Insurance Program policies (FEMA OpenFEMA, NFIP Redacted Policies v3) that took effect in the last 12 months in the chosen ZIP code or state. " +
      "Only annual, single-policy records that have started are used. The figure is policyCost: the premium plus the federal policy fee, surcharge and reserve fund assessment, i.e. the year's charge to the policyholder. " +
      "We publish the median and the 10th to 90th percentile, and never fewer than 5 policies. " +
      "NFIP rates follow federal rules, so these are real charges but not a free-market price, and private flood cover is not included.",
    describe: (x) =>
      `Typical NFIP flood insurance charge in ${label}: median ${x.median} USD a year (10th to 90th percentile ${x.low} to ${x.high} USD).`,
    baseUrl: opts.baseUrl,
    extra: enough
      ? {
          place: label,
          policies_in_period: total,
          sampled,
          ...(estimated ? { policies_in_period_is_estimate: true } : {}),
          ...(sampled ? { note: estimated ? `Summarised from ${policies.length} policies on ${DAY_SAMPLES} single days spread over the year; the yearly total is an estimate from their average daily count.` : `Summarised from a systematic sample of ${policies.length} of ${total} policies.` } : {}),
          premium_only: s.premium ? { median: s.premium.median, typical_low: s.premium.low, typical_high: s.premium.high, note: "Premium before federal fees, surcharge and reserve fund assessment." } : null,
          data_as_of: s.asOf,
          cover: "Flood insurance from the National Flood Insurance Program only.",
        }
      : { place: label, policies_in_period: total },
  });
}
