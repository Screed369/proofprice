// United States medicine prices as Medicare Part D paid them: "Medicare Part D Spending by Drug", published once a year by the
// Centers for Medicare & Medicaid Services (CMS) on data.cms.gov. For each brand/generic name (and each maker) it gives the
// total spending, the dosage units and claims behind it, and the AVERAGE SPENDING PER DOSAGE UNIT (weighted by units), for
// calendar years 2020 to the latest. Spending is what Part D plans and beneficiaries paid the pharmacy, BEFORE manufacturer
// rebates, so it is not the net price and not a cash price.
//
// Formats below were checked live on 2026-10-23 through the GitHub probe (probes pdlip1, pdato1, pdcon1, pdcon2):
//  - JSON array, no key: https://data.cms.gov/data-api/v1/dataset/7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b/data (size, offset);
//  - filter[Brnd_Name]=Lipitor is an exact match; a CONTAINS filter is filter[g][condition][path]=Gnrc_Name &
//    filter[g][condition][operator]=CONTAINS & filter[g][condition][value]=atorvastatin; it can be combined with
//    filter[Mftr_Name]=Overall (one row per brand = all makers together); the `columns` parameter is ignored (full rows come back);
//  - every field is a string; an empty string means "not published that year"; per year YYYY: Tot_Spndng_, Tot_Dsg_Unts_, Tot_Clms_,
//    Tot_Benes_, Avg_Spnd_Per_Dsg_Unt_Wghtd_, Avg_Spnd_Per_Clm_, Avg_Spnd_Per_Bene_, Outlier_Flag_ (2020 to 2024 on 2026-10-23).
//
// The figure is an official statistic (CMS publishes the average), so it uses buildStatisticAnswer, measure "average".
// It is answered when the request says basis=medicare_spend; plain medicine requests stay with us-nadac (declared serves()).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError } from "../../lib/http";
import type { Params, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-cms-partd",
  country: "US (United States)",
  category: "medicines (Medicare Part D spending per dosage unit)",
  name: "Medicare Part D Spending by Drug (annual)",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "Once a year, for each drug name (brand or generic) and each manufacturer: the total amount Medicare Part D plans and beneficiaries spent at pharmacies, " +
    "the dosage units (tablets, capsules, millilitres...) and prescription claims behind it, and the average spending per dosage unit weighted by units, for calendar years 2020 onward.",
  price_type: "official_statistic",
  freshness: "Annual; the newest data year is stated in every answer (2024 on 2026-10-23)",
  licence:
    "U.S. Government work. The CMS dataset record on data.gov (read 2026-10-23, https://catalog.data.gov/dataset/medicare-part-d-spending-by-drug) gives the licence https://www.usa.gov/government-works. " +
    "USAGov also states: \"You cannot use government materials in a way that implies endorsement by a government agency, official, or employee.\"",
  licence_url: "https://www.usa.gov/government-works",
  attribution:
    "Source: Centers for Medicare & Medicaid Services (CMS), Medicare Part D Spending by Drug, data.cms.gov. " +
    "ProofPrice is not affiliated with or endorsed by CMS. Figures are passed on as published; drug names are trademarks of their owners and are used only to name the drug.",
  homepage: "https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-d-spending-by-drug",
  limits:
    "Spending is what Part D plans and beneficiaries paid pharmacies for these prescriptions BEFORE manufacturer rebates and discounts, so it is a gross figure, not the net price Medicare ended up paying. " +
    "It covers only prescriptions filled by Part D enrollees (people on Medicare, mostly 65 and older), national totals only (no state or pharmacy), and the newest data year is at least a year old. " +
    "It includes the pharmacy's fees and any plan or patient cost sharing, so it is not the pharmacy's acquisition cost and not a cash price. " +
    "CMS suppresses rows with fewer than 11 claims; we also skip rows CMS flags as outliers. " +
    "A dosage unit is the unit the drug is dispensed in (tablet, capsule, millilitre, gram, pen, ...); price per unit is not comparable between drugs dispensed in different units.",
};

const DATASET = "7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b";
export const API = `https://data.cms.gov/data-api/v1/dataset/${DATASET}/data`;
export const PAGE_SIZE = 200;
export const MIN_CLAIMS = 11;

export type Fetcher = (url: string) => Promise<unknown>;
const defaultFetcher: Fetcher = (url) => fetchJson(url, {}, 25000);

/** True when the request asks for what Medicare Part D spent (basis=medicare_spend); everything else is a pharmacy-cost question for us-nadac. */
export function isMedicareSpendRequest(p: Params): boolean {
  const b = String(p.basis ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return b === "medicarespend" || b === "medicare" || b === "partd" || b === "medicarepartd" || b === "spending";
}

/** First word of what the user typed, lower case, salt/strength words dropped ("Atorvastatin 20mg" -> "atorvastatin"). */
export function medicineName(input: string | undefined): string {
  const first = String(input ?? "").trim().toLowerCase().split(/[\s,;/]+/).find((w) => /[a-z]/.test(w) && !/^\d/.test(w) && !/^(mg|mcg|g|ml|iu|unit|units|tablet|tablets|tab|tabs|capsule|capsules|cap|caps)$/.test(w)) ?? "";
  return first.replace(/[^a-z0-9-]/g, "");
}

const q = (s: string) => encodeURIComponent(s);
/** Overall (all makers) rows whose generic name contains the word ("contains") or whose brand name contains it ("brand"). */
export function partdUrl(name: string, by: "generic" | "brand"): string {
  const path = by === "generic" ? "Gnrc_Name" : "Brnd_Name";
  return (
    `${API}?filter%5Bn%5D%5Bcondition%5D%5Bpath%5D=${path}&filter%5Bn%5D%5Bcondition%5D%5Boperator%5D=CONTAINS` +
    `&filter%5Bn%5D%5Bcondition%5D%5Bvalue%5D=${q(name)}&filter%5BMftr_Name%5D=Overall&size=${PAGE_SIZE}`
  );
}

export interface DrugRow {
  brand: string;
  generic: string;
  year: number;
  perUnit: number; // USD per dosage unit, weighted by units
  perClaim: number | null;
  perBene: number | null;
  spending: number | null;
  units: number | null;
  claims: number;
  benes: number | null;
  outlier: boolean;
  makers: number | null;
}

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** The calendar years present in a row as Avg_Spnd_Per_Dsg_Unt_Wghtd_YYYY keys, newest first. */
export function yearsIn(rec: Record<string, unknown>): number[] {
  return Object.keys(rec)
    .map((k) => /^Avg_Spnd_Per_Dsg_Unt_Wghtd_(\d{4})$/.exec(k)?.[1])
    .filter((y): y is string => !!y)
    .map(Number)
    .sort((a, b) => b - a);
}

/** Parse the API array. Each record becomes the row of its newest year that has a figure (rows without any figure are dropped). */
export function parseRows(json: unknown): DrugRow[] {
  if (!Array.isArray(json)) return [];
  const out: DrugRow[] = [];
  for (const rec of json as Record<string, unknown>[]) {
    for (const y of yearsIn(rec)) {
      const perUnit = num(rec[`Avg_Spnd_Per_Dsg_Unt_Wghtd_${y}`]);
      const claims = num(rec[`Tot_Clms_${y}`]);
      if (perUnit === null || claims === null) continue;
      out.push({
        brand: String(rec.Brnd_Name ?? "").trim(),
        generic: String(rec.Gnrc_Name ?? "").trim(),
        year: y,
        perUnit,
        perClaim: num(rec[`Avg_Spnd_Per_Clm_${y}`]),
        perBene: num(rec[`Avg_Spnd_Per_Bene_${y}`]),
        spending: num(rec[`Tot_Spndng_${y}`]),
        units: num(rec[`Tot_Dsg_Unts_${y}`]),
        claims,
        benes: num(rec[`Tot_Benes_${y}`]),
        outlier: String(rec[`Outlier_Flag_${y}`] ?? "") === "1",
        makers: num(rec.Tot_Mftr),
      });
      break;
    }
  }
  return out;
}

/** Rows usable as a published figure: enough claims, not an outlier. */
export const usable = (r: DrugRow) => r.claims >= MIN_CLAIMS && !r.outlier && r.perUnit > 0;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Pick the headline row: the row for a name the user typed exactly (brand name, or the generic sold under its own name), else the
 *  single-ingredient row with the most claims. Combination products ("A/B") never head an answer for a single-ingredient name. */
export function pickHeadline(rows: DrugRow[], name: string): { head: DrugRow; why: "brand_match" | "generic_match" | "most_claims" } | null {
  const ok = rows.filter(usable);
  if (!ok.length) return null;
  const newest = Math.max(...ok.map((r) => r.year));
  const cur = ok.filter((r) => r.year === newest);
  const pool = cur.length ? cur : ok;
  const brandHit = pool.filter((r) => same(r.brand, name));
  if (brandHit.length) return { head: brandHit.sort((a, b) => b.claims - a.claims)[0], why: "brand_match" };
  // the generic sold under its own name (Brnd_Name "Atorvastatin Calcium"): all generic makers together
  const genericHit = pool.filter((r) => same(r.brand, r.generic) && r.generic.toLowerCase().startsWith(name) && !r.generic.includes("/"));
  if (genericHit.length) return { head: genericHit.sort((a, b) => b.claims - a.claims)[0], why: "generic_match" };
  const single = pool.filter((r) => !r.generic.includes("/") && !r.brand.includes("/"));
  const from = single.length ? single : pool;
  return { head: [...from].sort((a, b) => b.claims - a.claims)[0], why: "most_claims" };
}

const usd = (v: number) => (v >= 100 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const r4 = (v: number) => Number(v.toPrecision(5));

export interface PartDInput {
  medicine?: string;
  baseUrl?: string;
}

export async function partdMedicine(input: PartDInput, fetcher: Fetcher = defaultFetcher): Promise<PriceAnswer> {
  const name = medicineName(input.medicine);
  if (!name) throw new InputError("medicine is required: a brand or generic drug name such as 'atorvastatin' or 'Lipitor'.");
  let rows = parseRows(await fetcher(partdUrl(name, "generic")));
  if (!rows.length) rows = parseRows(await fetcher(partdUrl(name, "brand")));
  const pick = pickHeadline(rows, name);
  const query = { country: "US", medicine: input.medicine ?? name, basis: "medicare_spend" };
  if (!pick) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "USD", unit: "per dosage unit",
      period: { from: null, to: null }, reference_period: "Medicare Part D Spending by Drug", method: methodText(),
      describe: () => "", baseUrl: input.baseUrl,
      extra: {
        hint: rows.length
          ? "CMS publishes this drug name only with fewer than 11 claims or as an outlier in its newest year, so no figure is given."
          : "No Part D drug name contains this word. Try the generic name (CMS uses names such as 'Atorvastatin Calcium', 'Metformin HCl') or the brand name.",
      },
    });
  }
  const { head, why } = pick;
  const year = head.year;
  const others = rows
    .filter((r) => usable(r) && r.year === year && !(r.brand === head.brand && r.generic === head.generic))
    .sort((a, b) => b.claims - a.claims);
  const dropped = rows.filter((r) => r.claims < MIN_CLAIMS || r.outlier).length;
  const label = same(head.brand, head.generic) ? head.generic : `${head.brand} (${head.generic})`;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: head.perUnit,
    measure: "average",
    currency: "USD",
    unit: "per dosage unit",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: `calendar year ${year}`,
    sample_size: head.claims,
    method: methodText(),
    note: "Medicare Part D spending before manufacturer rebates; not a cash price and not the pharmacy's cost.",
    baseUrl: input.baseUrl,
    describe: (v) =>
      `In ${year}, Medicare Part D spent about ${usd(v)} per dosage unit (tablet, capsule, mL...) on ${label}, from ${head.claims.toLocaleString("en-US")} prescription claims. ` +
      `That is the gross amount paid to pharmacies before manufacturer rebates, for people on Medicare, not a cash price.`,
    extra: {
      what_the_figure_is:
        "CMS Medicare Part D Spending by Drug: total Part D spending divided by dosage units for this drug name (all makers together), before rebates. Includes plan and patient payments to the pharmacy.",
      headline_drug: { brand: head.brand, generic: head.generic },
      headline_basis:
        why === "brand_match" ? "the drug name you gave (a brand name in the CMS file)"
        : why === "generic_match" ? "the generic sold under its own name, all generic makers together"
        : "the single-ingredient drug name with the most claims; give a brand name or the exact CMS generic name for another",
      data_year: year,
      claims: head.claims,
      beneficiaries: head.benes,
      total_spending_usd: head.spending,
      dosage_units: head.units,
      average_spending_per_claim_usd: head.perClaim === null ? null : r4(head.perClaim),
      average_spending_per_beneficiary_usd: head.perBene === null ? null : r4(head.perBene),
      manufacturers: head.makers,
      other_matches: others.slice(0, 15).map((r) => ({
        brand: r.brand, generic: r.generic, average_spending_per_dosage_unit_usd: r4(r.perUnit), claims: r.claims, data_year: r.year,
      })),
      ...(others.length > 15 ? { other_matches_shown: 15, other_matches_total: others.length } : {}),
      ...(dropped ? { rows_skipped: dropped, rows_skipped_reason: "fewer than 11 claims or flagged as an outlier by CMS" } : {}),
    },
  });
}

export function methodText(): string {
  return (
    "United States (medicines, Medicare Part D spending): the average spending per dosage unit that CMS publishes once a year in 'Medicare Part D Spending by Drug' " +
    "(total Part D spending divided by dosage units, all makers together, before manufacturer rebates). We pass the published figure on for the newest data year with the number of claims behind it; " +
    "rows with fewer than 11 claims or flagged as outliers are skipped. Official statistic for people on Medicare; not a cash price and not the pharmacy's acquisition cost (see basis for that)."
  );
}
