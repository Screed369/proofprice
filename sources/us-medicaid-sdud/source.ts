// United States medicine prices as State Medicaid programmes paid them: "State Drug Utilization Data", published by the Centers
// for Medicare & Medicaid Services (CMS) on data.medicaid.gov. Per drug package (NDC), state and quarter: units, prescriptions and
// the total amount reimbursed to pharmacies. CMS also publishes a national row per NDC (state "XX"), which is what we read:
// amount reimbursed divided by units = the average reimbursement per tablet / capsule / mL / gram, weighted by units.
//
// Formats checked live on 2026-10-23 through the GitHub probe (mcd-2, mcd-3, mcd-4), key-free DKAN API:
//  - GET https://data.medicaid.gov/api/1/datastore/query/<datasetId>/0 with conditions[i][property|value|operator] (LIKE with %),
//    sorts[0][property]=quarter&sorts[0][order]=desc, properties[i]=<field>, limit (500 used), offset; JSON {results, count, ...};
//  - the 2025 dataset id is 158a1baa-5506-400a-8ec3-97756f0b0536 (one dataset per year); it holds quarters 1 to 4 of 2025 on 2026-10-23;
//  - every value is a string; fields: utilization_type (FFSU fee-for-service, MCOU managed care), state, ndc, year, quarter,
//    suppression_used, product_name (CUT TO 10 CHARACTERS, e.g. "ATORVASTAT", "LIPITOR"), units_reimbursed, number_of_prescriptions,
//    total_amount_reimbursed, medicaid_amount_reimbursed, non_medicaid_amount_reimbursed.
// A request is answered when it says basis=medicaid; every other US medicine request stays with us-nadac / us-cms-partd (declared serves()).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError } from "../../lib/http";
import type { Params, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-medicaid-sdud",
  country: "US (United States)",
  category: "medicines (Medicaid reimbursement per unit)",
  name: "Medicaid State Drug Utilization Data (quarterly, national)",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "Every quarter, for each drug package (NDC): the units dispensed, the prescriptions filled and the total amount State Medicaid programmes reimbursed pharmacies " +
    "(fee-for-service and managed care), as national totals.",
  price_type: "reimbursement_price",
  freshness: "Quarterly; the data year and quarter are stated in every answer (2025 Q4 on 2026-10-23)",
  licence:
    "Public domain (U.S. Government work). The CMS dataset record on data.gov (read 2026-10-23, https://catalog.data.gov/dataset/state-drug-utilization-data-2025) gives the licence " +
    "https://www.usa.gov/publicdomain/label/1.0/. USAGov also states: \"You cannot use government materials in a way that implies endorsement by a government agency, official, or employee.\"",
  licence_url: "https://www.usa.gov/publicdomain/label/1.0/",
  attribution:
    "Source: CMS, Medicaid State Drug Utilization Data, data.medicaid.gov. ProofPrice is not affiliated with or endorsed by CMS. " +
    "Figures are computed from the published totals; drug names are trademarks of their owners and are used only to name the drug.",
  homepage: "https://data.medicaid.gov/dataset/158a1baa-5506-400a-8ec3-97756f0b0536",
  limits:
    "This is what State Medicaid programmes reimbursed pharmacies (ingredient cost plus dispensing fee, before the rebates manufacturers pay Medicaid), so it is a reimbursement, not a cash price and not the pharmacy's acquisition cost. " +
    "It covers prescriptions for people on Medicaid, national totals only (state rows are not used), one quarter at a time. " +
    "CMS shortens drug names to 10 characters (ATORVASTAT), so brand and generic cannot always be told apart. " +
    "Rows CMS suppresses are skipped, and no figure is given from fewer than 5 prescriptions. " +
    "Price per unit is not comparable between drugs dispensed in different units (tablet, mL, gram, pen...).",
};

export const DATASET = "158a1baa-5506-400a-8ec3-97756f0b0536";
export const DATASET_YEAR = 2025;
export const API = `https://data.medicaid.gov/api/1/datastore/query/${DATASET}/0`;
export const PAGE_SIZE = 500;
export const MAX_PAGES = 4;
export const MIN_RX = 5;

export type Fetcher = (url: string) => Promise<unknown>;
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, 25000);

/** True when the request asks for what Medicaid reimbursed (basis=medicaid). */
export function isMedicaidRequest(p: Params): boolean {
  const b = String(p.basis ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return b === "medicaid" || b === "medicaidspend" || b === "medicaidreimbursement" || b === "sdud" || b === "statemedicaid";
}

/** First word of what the user typed (strength and form words dropped), upper case, cut to the 10 characters CMS keeps. */
export function medicinePrefix(input: string | undefined): string {
  const first = String(input ?? "").trim().toLowerCase().split(/[\s,;/]+/).find((w) => /[a-z]/.test(w) && !/^\d/.test(w) && !/^(mg|mcg|g|ml|iu|unit|units|tablet|tablets|tab|tabs|capsule|capsules|cap|caps)$/.test(w)) ?? "";
  return first.replace(/[^a-z0-9-]/g, "").toUpperCase().slice(0, 10);
}

const enc = encodeURIComponent;
const cond = (i: number, property: string, value: string, operator?: string) =>
  `conditions${enc("[")}${i}${enc("]")}${enc("[")}property${enc("]")}=${property}&conditions${enc("[")}${i}${enc("]")}${enc("[")}value${enc("]")}=${enc(value)}` +
  (operator ? `&conditions${enc("[")}${i}${enc("]")}${enc("[")}operator${enc("]")}=${operator}` : "");
const FIELDS = ["ndc", "product_name", "units_reimbursed", "number_of_prescriptions", "total_amount_reimbursed", "suppression_used"];
const props = FIELDS.map((f, i) => `properties${enc("[")}${i}${enc("]")}=${f}`).join("&");

/** The newest quarter in the dataset (one row, sorted by quarter descending). */
export function latestQuarterUrl(): string {
  return `${API}?limit=1&properties${enc("[")}0${enc("]")}=quarter&properties${enc("[")}1${enc("]")}=year&sorts${enc("[")}0${enc("]")}${enc("[")}property${enc("]")}=quarter&sorts${enc("[")}0${enc("]")}${enc("[")}order${enc("]")}=desc&${cond(0, "state", "XX")}`;
}

/** National rows of one quarter whose product name contains the (up to 10 character) prefix. */
export function drugUrl(prefix: string, quarter: number, offset = 0): string {
  return `${API}?limit=${PAGE_SIZE}&offset=${offset}&${props}&${cond(0, "state", "XX")}&${cond(1, "quarter", String(quarter))}&${cond(2, "product_name", `%${prefix}%`, "LIKE")}`;
}

export interface SdudRow {
  product: string;
  ndc: string;
  units: number;
  rx: number;
  amount: number;
}

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function parseRows(json: unknown): SdudRow[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: SdudRow[] = [];
  for (const r of results as Record<string, unknown>[]) {
    if (String(r.suppression_used ?? "").toLowerCase() === "true") continue;
    const units = num(r.units_reimbursed), rx = num(r.number_of_prescriptions), amount = num(r.total_amount_reimbursed);
    if (units === null || rx === null || amount === null || units <= 0 || amount <= 0 || rx <= 0) continue;
    out.push({ product: String(r.product_name ?? "").trim(), ndc: String(r.ndc ?? ""), units, rx, amount });
  }
  return out;
}

export interface Group { product: string; units: number; rx: number; amount: number; perUnit: number; ndcs: number }

/** One group per product name: reimbursement per unit = total amount / total units, over all packages. */
export function groupRows(rows: SdudRow[]): Group[] {
  const m = new Map<string, { units: number; rx: number; amount: number; ndcs: Set<string> }>();
  for (const r0 of rows) {
    const r = { ...r0, product: r0.product.toUpperCase() }; // CMS spells a name in two cases (ATORVASTAT / Atorvastat): one drug
    const g = m.get(r.product) ?? { units: 0, rx: 0, amount: 0, ndcs: new Set<string>() };
    g.units += r.units; g.rx += r.rx; g.amount += r.amount; g.ndcs.add(r.ndc);
    m.set(r.product, g);
  }
  return [...m.entries()]
    .map(([product, g]) => ({ product, units: g.units, rx: g.rx, amount: g.amount, perUnit: g.amount / g.units, ndcs: g.ndcs.size }))
    .sort((a, b) => b.rx - a.rx);
}

/** Headline: the group that starts with what was typed and has the most prescriptions (combination products come after), else the most prescriptions. */
export function pickHeadline(groups: Group[], prefix: string): Group | null {
  const ok = groups.filter((g) => g.rx >= MIN_RX);
  if (!ok.length) return null;
  const starts = ok.filter((g) => g.product.toUpperCase().startsWith(prefix) && !/[-/]/.test(g.product.slice(prefix.length)));
  return (starts.length ? starts : ok)[0];
}

const usd = (v: number) => (v >= 100 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const r4 = (v: number) => Number(v.toPrecision(5));
const quarterDates = (year: number, q: number) => {
  const m = (q - 1) * 3;
  const from = new Date(Date.UTC(year, m, 1)), to = new Date(Date.UTC(year, m + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

export interface MedicaidInput { medicine?: string; baseUrl?: string }

export async function medicaidMedicine(input: MedicaidInput, fetcher: Fetcher = defaultFetcher): Promise<PriceAnswer> {
  const prefix = medicinePrefix(input.medicine);
  if (!prefix) throw new InputError("medicine is required: a brand or generic drug name such as 'atorvastatin' or 'Lipitor'.");
  const latest = (await fetcher(latestQuarterUrl())) as { results?: Record<string, unknown>[] };
  const q = num(latest?.results?.[0]?.quarter), year = num(latest?.results?.[0]?.year) ?? DATASET_YEAR;
  if (q === null) throw new InputError("Medicaid drug data is not available right now (no quarter found).");
  const rows: SdudRow[] = [];
  let count = 0, fetched = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = (await fetcher(drugUrl(prefix, q, page * PAGE_SIZE))) as { count?: number; results?: unknown[] };
    const got = Array.isArray(json?.results) ? json.results.length : 0;
    count = Number(json?.count ?? count) || count;
    fetched += got;
    rows.push(...parseRows(json));
    if (got < PAGE_SIZE) break;
  }
  const groups = groupRows(rows);
  const head = pickHeadline(groups, prefix);
  const query = { country: "US", medicine: input.medicine ?? prefix, basis: "medicaid" };
  const period = quarterDates(year, q);
  const refPeriod = `${year} Q${q}`;
  if (!head) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "USD", unit: "per dosage unit", period, reference_period: refPeriod,
      method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: {
        hint: groups.length
          ? "Medicaid paid for fewer than 5 prescriptions of this drug name in the newest quarter, so no figure is given."
          : "No Medicaid drug name starts with or contains this word. CMS cuts names to 10 characters (ATORVASTAT, LIPITOR): try the generic or brand name.",
      },
    });
  }
  const others = groups.filter((g) => g !== head && g.rx >= MIN_RX).slice(0, 15);
  const truncated = count > fetched;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: head.perUnit,
    measure: "average",
    currency: "USD",
    unit: "per dosage unit",
    period,
    reference_period: refPeriod,
    sample_size: head.rx,
    method: methodText(),
    note: "Amount State Medicaid programmes reimbursed pharmacies, before manufacturer rebates; not a cash price and not the pharmacy's cost.",
    baseUrl: input.baseUrl,
    describe: (v) =>
      `In ${refPeriod}, State Medicaid programmes reimbursed pharmacies about ${usd(v)} per dosage unit (tablet, capsule, mL...) of ${head.product}, from ${head.rx.toLocaleString("en-US")} prescriptions. ` +
      `That is the amount paid to pharmacies for people on Medicaid, before manufacturer rebates, not a cash price.`,
    extra: {
      what_the_figure_is: "Total amount reimbursed divided by total units for this drug name in CMS Medicaid State Drug Utilization Data (national row, fee-for-service and managed care together, all packages).",
      headline_drug: head.product,
      data_year: year,
      data_quarter: q,
      prescriptions: head.rx,
      units: Math.round(head.units),
      packages_ndc: head.ndcs,
      total_reimbursed_usd: Math.round(head.amount),
      other_matches: others.map((g) => ({ product: g.product, average_reimbursement_per_dosage_unit_usd: r4(g.perUnit), prescriptions: g.rx })),
      ...(truncated ? { rows_read: fetched, rows_total: count, rows_note: "Only the first rows of a very large match were read." } : {}),
    },
  });
}

export function methodText(): string {
  return (
    "United States (medicines, Medicaid reimbursement): from CMS's quarterly State Drug Utilization Data we take the national rows for the newest quarter, add up the amount reimbursed and the units for every package of the drug name, " +
    "and divide (a unit-weighted average, fee-for-service and managed care together). The number of prescriptions is the sample size. Names are CMS's 10-character product names. " +
    "A reimbursement to pharmacies for people on Medicaid, before manufacturer rebates; not a cash price and not the pharmacy's acquisition cost."
  );
}
