// Medicare Inpatient Hospitals - by Geography and Service (data.cms.gov, key-free data API).
// Formats checked live on 2026-10-14 through the GitHub Probe workflow (see source.test.ts for the fixtures).
//
// One row per MS-DRG (a hospital-stay group) x geography (the nation or one state):
//   Rndrng_Prvdr_Geo_Lvl "National"|"State", Rndrng_Prvdr_Geo_Cd, Rndrng_Prvdr_Geo_Desc ("National", "Texas"), DRG_Cd ("470"), DRG_Desc (CMS's MS-DRG title,
//   upper case), Tot_Dschrgs, Avg_Submtd_Cvrd_Chrg (what hospitals billed: a list price, NEVER presented as a price paid),
//   Avg_Tot_Pymt_Amt (total payment to the hospital for the stay: Medicare's DRG, teaching, disproportionate-share, capital and outlier payments plus the
//   patient's deductible and co-payments and any third-party payment), Avg_Mdcr_Pymt_Amt (the part Medicare itself pays).
// The answer is an official statistic: the published average total payment for the stay, with the number of discharges behind it.
// MS-DRG codes and titles are the public Medicare payment-classification system (not AMA CPT). CMS leaves out groups with 10 or fewer discharges.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";
import { CmsOptions, cmsQuery, count, dataYear, Geo, INPATIENT_DATASET, numOrNull, round2, usd } from "../us-cms-medicare/cms";

export const INFO: SourceInfo = {
  id: "us-cms-inpatient",
  country: "US",
  category: "doctor and hospital prices (Medicare)",
  name: "Medicare Inpatient Hospitals - by Geography and Service",
  publisher: "Centers for Medicare & Medicaid Services (CMS)",
  what_is_recorded:
    "For each MS-DRG (a hospital-stay group such as 'major hip and knee joint replacement without MCC'), state and the nation, for Medicare fee-for-service hospital stays: the number of discharges, " +
    "the average total payment to the hospital, the average Medicare payment and the average amount the hospitals billed. Averages only; CMS leaves out groups with 10 or fewer discharges.",
  price_type: "official_statistic",
  freshness: "Annual: one calendar year at a time (the 2024 data year was released in 2026); every answer states its data year",
  licence:
    "U.S. Government Works (the licence the Data.gov catalog lists for this dataset; no separate licence is stated on data.cms.gov). " +
    "MS-DRG codes and titles are the Medicare payment classification published by CMS (they are not AMA CPT codes).",
  licence_url: "https://www.usa.gov/government-works",
  attribution:
    "Source: Centers for Medicare & Medicaid Services, Medicare Inpatient Hospitals - by Geography and Service (data.cms.gov). Amounts are what hospitals were paid for Medicare fee-for-service stays, passed on as published.",
  homepage: "https://data.cms.gov/provider-summary-by-type-of-service/medicare-inpatient-hospitals/medicare-inpatient-hospitals-by-geography-and-service",
  limits:
    "What was paid for Medicare fee-for-service hospital stays (Medicare Advantage is not included): Medicare-set payment rates, which are usually lower than private-insurance and cash prices, and not a quote. " +
    "The figure is the hospital's total payment for the stay; the surgeon's and other doctors' fees are billed separately and are not included. " +
    "A DRG group mixes patients of different severity (MCC = major complication or comorbidity, CC = complication or comorbidity), so the severity levels are listed side by side. " +
    "Annual data, about 16 months old when released. CMS leaves out groups with 10 or fewer discharges. What hospitals billed is a list price and is never shown as a price paid.",
};

export interface InpatientRow {
  geo: string;
  geoCode: string;
  level: string;
  drg: string;
  title: string;
  discharges: number;
  billed: number | null;
  total: number;
  medicare: number | null;
}

/** Rows of the CMS file -> typed rows. A row without a positive total payment or discharge count is dropped. */
export function parseInpatientRows(rows: Record<string, any>[]): InpatientRow[] {
  const out: InpatientRow[] = [];
  for (const r of rows) {
    const discharges = numOrNull(r.Tot_Dschrgs);
    const total = numOrNull(r.Avg_Tot_Pymt_Amt);
    if (discharges === null || discharges <= 0 || total === null || total <= 0) continue;
    out.push({
      geo: String(r.Rndrng_Prvdr_Geo_Desc ?? ""),
      geoCode: String(r.Rndrng_Prvdr_Geo_Cd ?? ""),
      level: String(r.Rndrng_Prvdr_Geo_Lvl ?? ""),
      drg: String(r.DRG_Cd ?? "").padStart(3, "0"),
      title: String(r.DRG_Desc ?? ""),
      discharges,
      billed: numOrNull(r.Avg_Submtd_Cvrd_Chrg),
      total,
      medicare: numOrNull(r.Avg_Mdcr_Pymt_Amt),
    });
  }
  return out;
}

/** The rows of the given DRGs for the state asked (or the nation) and for the nation. */
export async function fetchInpatient(drgs: string[], geo: Geo, o: CmsOptions = {}): Promise<InpatientRow[]> {
  const geos = geo.level === "State" ? [geo.desc, "National"] : ["National"];
  const rows = await cmsQuery(INPATIENT_DATASET, [{ field: "DRG_Cd", values: drgs }, { field: "Rndrng_Prvdr_Geo_Desc", values: geos }], drgs.length * 2 + 4, o);
  return parseInpatientRows(rows);
}

/** "MAJOR HIP AND KNEE JOINT REPLACEMENT ... WITHOUT MCC" -> "major hip and knee joint replacement ... without MCC". */
export function plainTitle(title: string): string {
  const keep = new Set(["mcc", "cc", "ecmo", "ami", "copd", "gi", "hiv", "pci", "tia", "dvt", "cabg", "tavr", "ent", "ptca", "icd", "nos"]);
  return title
    .toLowerCase()
    .replace(/[a-z]+/g, (w) => (keep.has(w) ? w.toUpperCase() : w))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find hospital-stay groups by words in the MS-DRG title (a fallback for requests the plain-words table does not know).
 * CMS's CONTAINS filter is case-insensitive and takes one phrase, so ask for the longest word and keep the rows whose title has all the words.
 * Returns the DRGs best first (most discharges nationally).
 */
export async function searchDrgTitles(words: string[], o: CmsOptions = {}): Promise<{ drg: string; title: string; discharges: number }[]> {
  const clean = [...new Set(words.map((w) => w.toLowerCase()).filter((w) => /^[a-z]{3,}$/.test(w)))];
  if (!clean.length) return [];
  const longest = [...clean].sort((a, b) => b.length - a.length)[0];
  const rows = parseInpatientRows(
    await cmsQuery(INPATIENT_DATASET, [{ field: "DRG_Desc", values: [longest], op: "CONTAINS" }, { field: "Rndrng_Prvdr_Geo_Lvl", values: ["National"] }], 100, o),
  );
  return rows
    .filter((r) => clean.every((w) => r.title.toLowerCase().includes(w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)))
    .sort((a, b) => b.discharges - a.discharges)
    .map((r) => ({ drg: r.drg, title: r.title, discharges: r.discharges }));
}

export interface InpatientContext {
  /** MS-DRGs of the request, the headline first. The first one with data in the geography is the headline; the rest are shown as other severity levels. */
  drgs: string[];
  geo: Geo;
  year: number | null;
  /** The plain name of the service when the request was in words, e.g. "knee replacement". Null for a raw DRG. */
  label?: string | null;
  /** The service exactly as the caller wrote it, echoed in the answer's query. */
  requested?: string;
  /** True when the caller asked for setting=inpatient (otherwise the query shows no setting). */
  settingAsked?: boolean;
  baseUrl?: string;
}

function yearPeriod(year: number | null): { from: string | null; to: string | null } {
  return year === null ? { from: null, to: null } : { from: `${year}-01-01`, to: `${year}-12-31` };
}

const METHOD =
  "CMS publishes, once a year, the average total payment to hospitals for Medicare fee-for-service stays in each MS-DRG group, by state and for the nation (dataset Medicare Inpatient Hospitals - by Geography and Service). " +
  "ProofPrice returns the published average for the latest data year, unchanged, with the number of discharges behind it, the share Medicare itself paid, the national average and the other severity levels of the same condition. " +
  "No range is calculated: CMS gives one average per group and place. It is what hospitals were paid under Medicare, not a private-insurance or cash price, and it does not include the surgeon's or other doctors' fees.";

/** The finished answer for a hospital-stay request. Pure. */
export function inpatientAnswer(rows: InpatientRow[], ctx: InpatientContext): PriceAnswer {
  const first = ctx.drgs[0];
  const query = { country: "US", service: ctx.requested ?? ctx.drgs.map((d) => `DRG ${d}`).join(","), state: ctx.geo.code, setting: ctx.settingAsked ? "inpatient" : null };
  const base = {
    source: INFO,
    query,
    measure: "average" as const,
    currency: "USD",
    unit: "per hospital stay (total payment to the hospital, Medicare rates)",
    method: METHOD,
    baseUrl: ctx.baseUrl,
  };
  const yearWords = ctx.year === null ? "the latest data year" : String(ctx.year);
  const where = ctx.geo.level === "State" ? ctx.geo.label : "the United States";
  const empty = (summary: string, status: PriceAnswer["status"]): PriceAnswer => ({
    ...buildStatisticAnswer({ ...base, value: null, period: yearPeriod(ctx.year), reference_period: ctx.year === null ? "latest data year" : String(ctx.year), describe: () => "" }),
    status,
    summary,
  });

  const headRow = ctx.drgs.map((d) => rows.find((r) => r.drg === d && r.geo === ctx.geo.desc)).find((r) => !!r) ?? null;
  if (!headRow) {
    const natl = ctx.geo.level === "State" && rows.some((r) => r.geo === "National");
    return empty(
      `The Medicare inpatient file has no average for MS-DRG ${first} in ${where} for ${yearWords}: CMS leaves out groups with 10 or fewer discharges, and the code may not exist in the file.` +
        (natl ? " A national figure exists: ask again without a state." : ""),
      "no_matches",
    );
  }
  if (headRow.discharges < MIN_PUBLISH) {
    return empty(`Only ${count(headRow.discharges)} discharge(s) behind the Medicare average for MS-DRG ${headRow.drg} in ${where}; at least ${MIN_PUBLISH} are needed before we publish a figure.`, "insufficient_data");
  }
  const natl = ctx.geo.level === "State" ? rows.find((r) => r.drg === headRow.drg && r.geo === "National") ?? null : null;
  const levels = ctx.drgs
    .filter((d) => d !== headRow.drg)
    .flatMap((d) => {
      const r = rows.find((x) => x.drg === d && x.geo === ctx.geo.desc);
      return r && r.discharges >= MIN_PUBLISH ? [{ drg: d, title: plainTitle(r.title), average_total_payment: round2(r.total), discharges: Math.round(r.discharges) }] : [];
    });
  const title = plainTitle(headRow.title);
  const name = ctx.label ? `${ctx.label} (MS-DRG ${headRow.drg}: ${title})` : `MS-DRG ${headRow.drg} (${title})`;

  const notes: string[] = [
    "This is the hospital's total payment for the stay under Medicare (Medicare's payment plus the patient's deductible and co-payments and any other insurer). The surgeon's and other doctors' fees are billed separately and are not in this figure.",
    "It is what was paid at Medicare rates, not what private insurance pays or the cash price; private-insurance and cash prices are usually higher.",
    "An MS-DRG group mixes patients with different complications: 'without MCC' is the group without a major complication or comorbidity, 'with MCC' the most complex. Other severity levels are listed under other_severity_levels.",
  ];
  if (headRow.drg !== first) notes.push(`There is no average for MS-DRG ${first} in ${where}, so the next group (${headRow.drg}) is shown.`);
  if (/HIP AND KNEE/i.test(headRow.title)) notes.push("This group covers hip and knee replacements together; CMS does not publish them separately.");
  if (ctx.year !== null && new Date().getUTCFullYear() - ctx.year >= 3) notes.push(`The newest data year CMS serves is ${ctx.year}, so these amounts may be out of date.`);

  return buildStatisticAnswer({
    ...base,
    value: headRow.total,
    period: yearPeriod(ctx.year),
    reference_period: ctx.year === null ? "latest data year (not stated by CMS)" : String(ctx.year),
    sample_size: Math.round(headRow.discharges),
    note: notes.join(" "),
    describe: (v) =>
      `For ${name} in ${where}, hospitals were paid an average of ${usd(v)} per Medicare stay in ${yearWords}, across ${count(headRow.discharges)} discharges.` +
      (headRow.medicare !== null ? ` Medicare itself paid ${usd(headRow.medicare)} of that on average; the patient's share and any other insurer cover the rest.` : "") +
      (natl ? ` The national average is ${usd(natl.total)}.` : "") +
      " This is the hospital's payment at Medicare rates (Medicare's payment plus the patient's cost-sharing), not a private-insurance or cash price and not the hospital's billed (list) charge, and it excludes the surgeon's fee.",
    extra: {
      drg: headRow.drg,
      drg_title: headRow.title,
      ...(ctx.label ? { service: ctx.label } : {}),
      code_system: "MS-DRG (Medicare Severity Diagnosis Related Group)",
      what_it_is: "average total payment to the hospital for a Medicare stay, at Medicare rates; not a private-insurance or cash price",
      geography: { level: headRow.level, name: headRow.geo, code: ctx.geo.code },
      setting: "inpatient",
      average_total_payment: round2(headRow.total),
      average_medicare_payment: headRow.medicare === null ? null : round2(headRow.medicare),
      discharges: Math.round(headRow.discharges),
      ...(headRow.billed !== null ? { average_billed_charge_not_a_price_paid: round2(headRow.billed) } : {}),
      national: natl ? { average_total_payment: round2(natl.total), discharges: Math.round(natl.discharges) } : null,
      ...(levels.length ? { other_severity_levels: levels } : {}),
      data_year: ctx.year,
      dataset: { name: INFO.name, id: INPATIENT_DATASET, url: INFO.homepage },
      notes,
    },
  });
}

/** Fetch and answer. The data year is looked up beside the rows; if CMS does not say, the answer says so. */
export async function medicareInpatient(input: Omit<InpatientContext, "year">, o: CmsOptions = {}): Promise<PriceAnswer> {
  const [rows, year] = await Promise.all([fetchInpatient(input.drgs, input.geo, o), dataYear(INPATIENT_DATASET, o)]);
  return inpatientAnswer(rows, { ...input, year });
}
