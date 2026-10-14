// US federal contract prices from USAspending.gov (U.S. Department of the Treasury, Bureau of the Fiscal Service).
// API facts (from the API's own contract documents, usaspending_api/api_contracts, read 2026-10-14):
//   POST https://api.usaspending.gov/api/v2/search/spending_by_award/   key-free, JSON body { filters, fields, limit<=100, page, sort, order }
//   filters: keywords[], time_period[{start_date,end_date,date_type}], award_type_codes (contracts = A,B,C,D), psc_codes[], naics_codes[],
//            place_of_performance_locations[{country,state}]
//   POST https://api.usaspending.gov/api/v2/search/spending_by_award_count/  -> { results: { contracts: n, ... } }
// An award's "Award Amount" is the total obligated to that contract or order so far (it can grow with modifications).
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import type { PriceAnswer } from "../../lib/answer";
import { contractAnswer } from "../../categories/contracts/answer";
import { matchPurchase, monthsWindow, normaliseText, sliceWindow } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "us-usaspending",
  country: "US (federal contracts)",
  category: "government contracts (federal awards)",
  name: "USAspending.gov: federal contract awards",
  publisher: "U.S. Department of the Treasury, Bureau of the Fiscal Service (USAspending.gov)",
  what_is_recorded:
    "Prime contract awards and orders made by US federal agencies (award types A BPA call, B purchase order, C delivery order, D definitive contract): description, product or service code (PSC), NAICS code, place of performance, start date and the total amount obligated.",
  price_type: "contract_price",
  freshness: "Daily: agencies report contract actions within days and USAspending refreshes nightly",
  licence:
    "No licence is stated for the data. It is US federal government spending data published as open data for public use (the data.gov catalogue lists it with access level 'public'); " +
    "works of the US federal government are not subject to copyright in the United States (17 U.S.C. 105). The USAspending API's source code is CC0 1.0 Universal.",
  licence_url: "https://www.usaspending.gov/",
  attribution:
    "Source: USAspending.gov, U.S. Department of the Treasury, Bureau of the Fiscal Service. Figures are ProofPrice aggregates of the published federal contract awards; USAspending does not warrant the data.",
  homepage: "https://www.usaspending.gov/",
  limits:
    "Federal agencies only (not state or local governments, not classified or some defence awards). The amount is the total obligated to the award so far, which may include later modifications and options, not a unit price. " +
    "Search is by keyword over the award description, so some matches are loosely related and small orders for accessories are included; up to 100 awards are read per period slice (the newest first), so a very common keyword is a sample rather than every award. Aggregates only; contractors are never named.",
};

export const BASE = "https://api.usaspending.gov/api/v2/search";
export const CONTRACT_TYPES = ["A", "B", "C", "D"];
export const PER_SLICE = 100;
/** Amounts below this are left out: zero-dollar and token entries (a $40 laptop riser, a $6 part) are not contract prices. */
export const MIN_VALUE = 100;

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

/** "California", "ca" or "CA" -> "CA"; null when it is not a US state or DC. */
export function stateCode(raw: string): string | null {
  const t = raw.trim();
  const up = t.toUpperCase();
  if (STATES[up]) return up;
  const n = normaliseText(t);
  for (const [code, name] of Object.entries(STATES)) if (normaliseText(name) === n) return code;
  return null;
}

/** A US product-or-service (PSC) or NAICS code. "psc:7010" and "naics:334111" are explicit; 4 digits count as PSC, 2, 3, 5 or 6 digits as NAICS. */
export function classifyUsCode(raw: string): { psc?: string; naics?: string } | null {
  const t = raw.trim();
  const m = t.match(/^(psc|naics)\s*[:=]\s*([A-Za-z0-9]+)$/i);
  if (m) return m[1].toLowerCase() === "psc" ? { psc: m[2].toUpperCase() } : { naics: m[2] };
  if (/^\d{4}$/.test(t) || /^[A-Za-z][A-Za-z0-9]{3}$/.test(t)) return { psc: t.toUpperCase() };
  if (/^\d{2,6}$/.test(t)) return { naics: t };
  return null;
}

export interface UsFilters {
  keywords?: string;
  psc?: string;
  naics?: string;
  state?: string;
}

export function buildFilters(f: UsFilters, slice: { from: string; to: string }, newAwardsOnly = true): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_TYPES,
    time_period: [{ start_date: slice.from, end_date: slice.to, ...(newAwardsOnly ? { date_type: "new_awards_only" } : {}) }],
  };
  if (f.psc) filters.psc_codes = [f.psc];
  else if (f.naics) filters.naics_codes = [f.naics];
  else if (f.keywords) filters.keywords = [f.keywords];
  if (f.state) filters.place_of_performance_locations = [{ country: "USA", state: f.state }];
  return filters;
}

export interface UsAward {
  id: string;
  amount: number;
  /** The date the award was first obligated (Base Obligation Date); the start date of the work can lie in the future. */
  date: string;
}

/** Pure parser for a spending_by_award response: one value per contract award, with the date it was first obligated. */
export function parseAwards(json: any): UsAward[] {
  if (!Array.isArray(json?.results)) throw new SourceError("Unexpected response from USAspending");
  const out: UsAward[] = [];
  for (const r of json.results) {
    const amount = Number(r?.["Award Amount"]);
    if (!Number.isFinite(amount) || amount < MIN_VALUE) continue;
    out.push({
      id: String(r?.internal_id ?? r?.generated_internal_id ?? ""),
      amount,
      date: String(r?.["Base Obligation Date"] ?? r?.["Start Date"] ?? "").slice(0, 10),
    });
  }
  return out;
}

async function post(path: string, body: unknown): Promise<any> {
  return fetchJson(
    `${BASE}/${path}/`,
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) },
    25000,
  );
}

async function sliceAwards(f: UsFilters, slice: { from: string; to: string }): Promise<{ awards: UsAward[]; full: boolean }> {
  const body = (newOnly: boolean) => ({
    filters: buildFilters(f, slice, newOnly),
    fields: ["Award Amount", "Base Obligation Date"],
    limit: PER_SLICE,
    page: 1,
    sort: "Base Obligation Date",
    order: "desc",
  });
  let json: any;
  try {
    json = await post("spending_by_award", body(true));
  } catch (e: any) {
    // Some deployments reject the "new awards only" period type: repeat with the default (action date).
    if (e instanceof SourceError && /HTTP 4\d\d/.test(e.message)) json = await post("spending_by_award", body(false));
    else throw e;
  }
  return { awards: parseAwards(json), full: Array.isArray(json?.results) && json.results.length >= PER_SLICE };
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export interface UsInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months: number;
  baseUrl?: string;
}

export async function usContracts(input: UsInput): Promise<PriceAnswer> {
  const win = monthsWindow(input.months);
  const f: UsFilters = {};
  let label = input.what;
  let how: string;
  if (input.cpv) {
    const code = classifyUsCode(input.cpv);
    if (!code) throw new InputError("For the US, cpv must be a PSC code (e.g. 7010 or psc:7010) or a NAICS code (e.g. 334111 or naics:334111).");
    Object.assign(f, code);
    how = code.psc ? `product or service code (PSC) ${code.psc}` : `NAICS code ${code.naics}`;
  } else {
    const p = matchPurchase(input.what);
    if (p) label = p.label;
    if (p?.usPsc) {
      f.psc = p.usPsc;
      how = `product or service code (PSC) ${p.usPsc} (repair or alteration of highways, roads, streets, bridges and railways)`;
    } else {
      f.keywords = p ? p.keyword : input.what;
      how = `the ${f.keywords.includes(" ") ? "phrase" : "keyword"} "${f.keywords}" in the award description`;
    }
  }
  let where = "the United States (federal agencies)";
  if (input.buyer_area) {
    const st = stateCode(input.buyer_area);
    if (!st) throw new InputError("For the US, buyer_area must be a state name or code (for example 'Virginia' or 'VA'): it filters by where the work is done.");
    f.state = st;
    where = `the United States (federal agencies, work in ${STATES[st]})`;
  }
  const slices = sliceWindow(win.from, win.to, Math.min(input.months, 12));
  const [perSlice, count] = await Promise.all([
    inBatches(slices, 6, (s) => sliceAwards(f, s)),
    post("spending_by_award_count", { filters: buildFilters(f, win, true) }).catch(() => null),
  ]);
  const seen = new Set<string>();
  const awards: UsAward[] = [];
  for (const { awards: list } of perSlice) {
    for (const a of list) {
      if (a.id && seen.has(a.id)) continue;
      if (a.id) seen.add(a.id);
      awards.push(a);
    }
  }
  const dates = awards.map((a) => a.date).filter(Boolean).sort();
  const matching = Number(count?.results?.contracts);
  const capped = perSlice.some((s) => s.full);
  const notes: string[] = [];
  if (capped) notes.push(`${Number.isFinite(matching) ? matching : "More"} matching awards exist; the newest ${PER_SLICE} of each period slice were read, ${awards.length} usable.`);
  notes.push(`Each amount is what had been obligated to the award so far, including later modifications; amounts under ${MIN_VALUE} dollars are left out.`);
  return contractAnswer({
    source: INFO,
    query: { country: "US", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}), ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}), months: input.months },
    values: awards.map((a) => a.amount),
    currency: "USD",
    what: label,
    where,
    period: { from: win.from, to: win.to },
    newest: dates.length ? dates[dates.length - 1] : null,
    method:
      `Federal contract awards and orders (types A, B, C, D) first awarded between ${win.from} and ${win.to}, found by ${how}` +
      (f.state ? ` with the place of performance in ${STATES[f.state]}` : "") +
      `. The window is read in ${slices.length} slices of up to ${PER_SLICE} awards each. Each award's amount is the total obligated to that contract or order so far. Median and 10th–90th percentile of those totals in USD; never contractor names. Totals per contract, not unit prices.`,
    notes,
    baseUrl: input.baseUrl,
    extra: {
      matched_filter: how,
      awards_read: awards.length,
      ...(Number.isFinite(matching) ? { awards_matching: matching } : {}),
      slices: slices.length,
    },
  });
}
