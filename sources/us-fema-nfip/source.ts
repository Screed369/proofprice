// US flood insurance (FEMA OpenFEMA, NFIP Redacted Policies v3). Key-free OData API. Format checked live on 2026-10-17 through the Probe workflow.
// GET https://www.fema.gov/api/open/v3/NfipPolicies?$filter=reportedZipCode eq '32935' and policyEffectiveDate ge '2025-10-17'&$select=...&$top=1000&$count=true
//   -> { metadata: { count: 908, ... }, NfipPolicies: [ { policyCost, totalInsurancePremiumOfThePolicy, policyCount, policyTermIndicator, occupancyType,
//        policyEffectiveDate, reportedZipCode, propertyState, asOfDate, federalPolicyFee, hfiaaSurcharge, reserveFundAssessment, ... } ] }
// policyCost = premium + federal policy fee + HFIAA surcharge + reserve fund assessment (what the policyholder is charged for the year).
// Privacy: the rows carry ZIP, census tract and dates, so rows are only ever summarised here; nothing per policy leaves this file, and under 5 policies gives no figure.

import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { fetchJson, InputError, SourceError } from "../../lib/http";
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

export function windowStart(now: Date = new Date(), months = 12): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export function buildUrl(area: Area, from: string, opts: { top?: number; skip?: number; count?: boolean } = {}): string {
  const filter = `${area.field} eq '${area.value}' and policyEffectiveDate ge '${from}'`;
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

/** Skips for the extra pages: evenly spread over the whole result so the sample is not just the first rows. */
export function sampleSkips(count: number, pages = STATE_PAGES - 1): number[] {
  if (count <= PAGE) return [];
  const span = count - PAGE;
  return Array.from({ length: pages }, (_, i) => Math.floor(((i + 1) * span) / pages));
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
  const get = opts.fetcher ?? ((u: string) => fetchJson(u, {}, 25000));
  const first = await get(buildUrl(area, from, { count: true }));
  const total = totalCount(first);
  let policies = parsePolicies(first);
  let sampled = false;
  const skips = sampleSkips(total);
  if (skips.length) {
    sampled = true;
    const more = await Promise.all(skips.map((skip) => get(buildUrl(area, from, { skip }))));
    for (const b of more) policies = policies.concat(parsePolicies(b));
  }
  if (total > 0 && !Array.isArray(first?.NfipPolicies)) throw new SourceError("The source answered in an unexpected format", "NfipPolicies missing");
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
          ...(sampled ? { note: `Summarised from a systematic sample of ${policies.length} of ${total} policies.` } : {}),
          premium_only: s.premium ? { median: s.premium.median, typical_low: s.premium.low, typical_high: s.premium.high, note: "Premium before federal fees, surcharge and reserve fund assessment." } : null,
          data_as_of: s.asOf,
          cover: "Flood insurance from the National Flood Insurance Program only.",
        }
      : { place: label, policies_in_period: total },
  });
}
