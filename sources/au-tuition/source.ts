// Australia university tuition: the maximum student contribution per EFTSL (one full-time year of study) for Commonwealth supported places,
// set by the Australian Government by field of education and indexed every 1 January. Source: Department of Education "Indexed rates" pages.
// Read in full on 2026-10-30 (WebFetch of the official PDFs):
//   2026: https://www.education.gov.au/download/19201/2026-indexed-rates/41481/document/pdf  (page https://www.education.gov.au/node/19201)
//   2027: https://www.education.gov.au/download/20451/2027-indexed-rates/45020/document/pdf  (page https://www.education.gov.au/node/20451)
// Both list "Non-grandfathered places" (students who started on or after 1 January 2021) and "Grandfathered places" (started before 1 January 2021)
// by funding cluster and field of education. The table is tiny and changes once a year, so the amounts are kept here as dated constants with
// their source URL (no download per request, nothing to harvest). When the Department publishes the next year, add one entry to RATES.
// A posted statutory maximum, not what any one student paid: universities may charge less, and HECS-HELP loans defer the payment.

import { InputError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const HOMEPAGE = "https://www.education.gov.au/higher-education-publications/indexed-rates";

export const INFO: SourceInfo = {
  id: "au-tuition",
  country: "AU (Australia)",
  category: "tuition (maximum student contribution, Commonwealth supported places)",
  name: "Commonwealth supported places: maximum student contribution amounts per EFTSL (Department of Education indexed rates)",
  publisher: "Australian Government Department of Education",
  what_is_recorded:
    "The maximum amount a university may charge a Commonwealth supported student for one equivalent full-time student load (EFTSL, one full-time year of study), " +
    "by field of education and funding cluster, for students who started on or after 1 January 2021 and for 'grandfathered' students who started before that date. Amounts are in Australian dollars and indexed each 1 January.",
  price_type: "official_statistic",
  freshness: "Annual rates, indexed each 1 January (2026 and 2027 amounts are published); every answer states its calendar year",
  licence:
    "Creative Commons Attribution 4.0 International. The Department of Education copyright page (https://www.education.gov.au/using-site/copyright, read 29 Oct 2026) says content on the site is under CC BY 4.0, " +
    "except third-party content, logos, the Coat of Arms, trade-marked material and images.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Australian Government Department of Education, Indexed rates (https://www.education.gov.au/higher-education-publications/indexed-rates). © Commonwealth of Australia, CC BY 4.0. " +
    "Amounts selected and restated by ProofPrice; this does not imply endorsement by the Department.",
  homepage: HOMEPAGE,
  limits:
    "The statutory maximum a university may charge a domestic Commonwealth supported student, not what any one student paid: a university can charge less, " +
    "and students usually defer the fee through a HECS-HELP loan. No sample size, no range. International students, full-fee places, postgraduate full-fee courses and non-university providers are not covered. " +
    "The amounts apply per EFTSL (one full-time year); a single unit costs a fraction of it. The table has one amount per field group, so a degree in two fields needs its units priced by field.",
};

export interface FieldGroup {
  id: string;
  label: string;
  cluster: number;
  /** Words (lower case, matched as whole words or phrases) that select this group. */
  words: string[];
}

/** The field-of-education groups, in the Department's table order. */
export const FIELDS: FieldGroup[] = [
  { id: "law_commerce", label: "Law, accounting, administration, economics or commerce", cluster: 1, words: ["law", "legal", "accounting", "administration", "economics", "commerce", "business", "finance", "management"] },
  { id: "society_culture", label: "Society and culture (humanities, social sciences) and communications", cluster: 1, words: ["society", "culture", "humanities", "communications", "communication", "media", "journalism", "history", "politics", "sociology", "anthropology", "social studies", "behavioural science", "behavioral science", "philosophy"] },
  { id: "education_english_maths", label: "Education, postgraduate clinical psychology, English, mathematics or statistics", cluster: 2, words: ["education", "teaching", "english", "mathematics", "maths", "math", "statistics", "clinical psychology"] },
  { id: "health_built_computing", label: "Allied health, other health, built environment or computing", cluster: 2, words: ["health", "allied health", "physiotherapy", "pharmacy", "built environment", "architecture", "computing", "computer science", "information technology", "software"] },
  { id: "arts_psychology_social_work", label: "Visual and performing arts, professional-pathway psychology or professional-pathway social work", cluster: 2, words: ["visual arts", "performing arts", "visual", "performing", "music", "drama", "design", "creative arts", "psychology", "social work"] },
  { id: "nursing_languages", label: "Nursing, Indigenous and foreign languages", cluster: 3, words: ["nursing", "midwifery", "languages", "language", "indigenous languages", "foreign languages"] },
  { id: "engineering_science", label: "Engineering, surveying, environmental studies or science", cluster: 3, words: ["engineering", "surveying", "environmental", "environmental studies", "science", "sciences", "physics", "chemistry", "biology"] },
  { id: "agriculture", label: "Agriculture", cluster: 4, words: ["agriculture", "agricultural"] },
  { id: "pathology", label: "Pathology", cluster: 4, words: ["pathology"] },
  { id: "medicine_dentistry_veterinary", label: "Medicine, dentistry or veterinary science", cluster: 4, words: ["medicine", "medical", "dentistry", "dental", "veterinary", "vet"] },
];

export type Commenced = "after_2020" | "before_2021";

export interface YearRates {
  year: number;
  /** Where the table was read. */
  url: string;
  /** Amounts in AUD per EFTSL, by field id, for students who started on or after 1 January 2021. */
  current: Record<string, number>;
  /** Amounts for grandfathered students (started before 1 January 2021). */
  grandfathered: Record<string, number>;
  /** Fee-free Uni Ready courses (cluster 5) cost students nothing. */
  uniReady: number;
}

/** Read from the Department's PDFs on 2026-10-30. Each field group is the amount printed on the matching row. */
export const RATES: YearRates[] = [
  {
    year: 2026,
    url: "https://www.education.gov.au/download/19201/2026-indexed-rates/41481/document/pdf",
    current: {
      law_commerce: 17399, society_culture: 17399, education_english_maths: 4738, health_built_computing: 9537, arts_psychology_social_work: 9537,
      nursing_languages: 4738, engineering_science: 9537, agriculture: 4738, pathology: 9537, medicine_dentistry_veterinary: 13558,
    },
    grandfathered: {
      law_commerce: 13624, society_culture: 8164, education_english_maths: 4738, health_built_computing: 9537, arts_psychology_social_work: 8164,
      nursing_languages: 4738, engineering_science: 9537, agriculture: 4738, pathology: 9537, medicine_dentistry_veterinary: 13558,
    },
    uniReady: 0,
  },
  {
    year: 2027,
    url: "https://www.education.gov.au/download/20451/2027-indexed-rates/45020/document/pdf",
    current: {
      law_commerce: 18025, society_culture: 18025, education_english_maths: 4908, health_built_computing: 9880, arts_psychology_social_work: 9880,
      nursing_languages: 4908, engineering_science: 9880, agriculture: 4908, pathology: 9880, medicine_dentistry_veterinary: 14046,
    },
    grandfathered: {
      law_commerce: 14114, society_culture: 8457, education_english_maths: 4908, health_built_computing: 9880, arts_psychology_social_work: 8457,
      nursing_languages: 4908, engineering_science: 9880, agriculture: 4908, pathology: 9880, medicine_dentistry_veterinary: 14046,
    },
    uniReady: 0,
  },
];

export const DEFAULT_FIELD = "law_commerce";

const norm = (s: string) => s.toLowerCase().replace(/[_\-/,]+/g, " ").replace(/\s+/g, " ").trim();

/** A field group from an id or free words ("nursing", "law", "computer science", "medicine"). */
export function resolveField(raw: string | undefined): FieldGroup {
  const text = norm(raw ?? "");
  if (!text) return FIELDS.find((f) => f.id === DEFAULT_FIELD)!;
  const byId = FIELDS.find((f) => norm(f.id) === text);
  if (byId) return byId;
  const padded = ` ${text} `;
  // The longest matching phrase wins ("visual arts" beats "arts"-style single words; "clinical psychology" beats "psychology").
  let best: { f: FieldGroup; len: number } | null = null;
  for (const f of FIELDS) {
    for (const w of f.words) {
      if (padded.includes(` ${norm(w)} `) && (!best || w.length > best.len)) best = { f, len: w.length };
    }
  }
  if (best) return best.f;
  throw new InputError(
    `Australia: '${raw}' is not a field group in the Department's table. Use one of ${FIELDS.map((f) => f.id).join(", ")}, or a plain word such as law, nursing, engineering, computing, medicine or education.`,
  );
}

function resolveCommenced(raw: string | undefined): Commenced {
  const t = norm(raw ?? "");
  if (!t || /^(after 2020|after|new|current|2021|non grandfathered|nongrandfathered)$/.test(t)) return "after_2020";
  if (/^(before 2021|before|grandfathered|grandparented|old|pre 2021|pre2021)$/.test(t)) return "before_2021";
  throw new InputError('commenced must be "after_2020" (started on or after 1 January 2021, the default) or "before_2021" (grandfathered students).');
}

export interface TuitionInput {
  cycle?: string;
  student_group?: string;
  study_mode?: string;
  field?: string;
  commenced?: string;
  year?: string;
  baseUrl?: string;
}

/** The newest table whose year has started (so 2026 amounts answer until 31 Dec 2026, 2027 amounts from 1 Jan 2027). */
export function defaultYear(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const known = RATES.map((r) => r.year);
  const hit = known.filter((k) => k <= y);
  return hit.length ? Math.max(...hit) : Math.min(...known);
}

export function auTuition(input: TuitionInput, now: Date = new Date()): PriceAnswer {
  const cycle = (input.cycle ?? "first").toString();
  if (cycle !== "first" && cycle !== "second") throw new InputError('cycle must be "first" or "second".');
  const group = (input.student_group ?? "home").toString();
  if (group !== "home") {
    throw new InputError("Australia: the Department publishes the Commonwealth supported (domestic) student contribution only; use student_group home or leave it out. International fees are set by each university and are not in this source.");
  }
  const mode = (input.study_mode ?? "full-time").toString();
  if (mode !== "full-time") throw new InputError("Australia: amounts are per EFTSL (one full-time year of study); leave study_mode out or use full-time.");

  const known = RATES.map((r) => r.year);
  let year = defaultYear(now);
  if (input.year !== undefined && String(input.year).trim() !== "") {
    const y = Number(String(input.year).trim());
    if (!known.includes(y)) throw new InputError(`year must be one of ${known.join(", ")} (the years the Department's indexed rates cover here).`);
    year = y;
  }
  const rates = RATES.find((r) => r.year === year)!;
  const field = resolveField(input.field);
  const commenced = resolveCommenced(input.commenced);
  const table = commenced === "after_2020" ? rates.current : rates.grandfathered;
  const value = table[field.id];
  const fieldGiven = input.field !== undefined && String(input.field).trim() !== "";
  const prev = RATES.find((r) => r.year === year - 1);
  const prevValue = prev ? (commenced === "after_2020" ? prev.current : prev.grandfathered)[field.id] : undefined;
  const change = prevValue ? Math.round(((value - prevValue) / prevValue) * 1000) / 10 : null;
  const who = commenced === "after_2020" ? "students who started on or after 1 January 2021" : "grandfathered students (started before 1 January 2021)";
  const dollars = (v: number) => `${Math.round(v).toLocaleString("en-AU")} AUD`;
  const caveats = [
    "This is the maximum a university may charge a Commonwealth supported student for one full-time year (EFTSL), not what any one student paid: universities can charge less and most students defer the fee through a HECS-HELP loan.",
  ];
  if (!fieldGiven) caveats.push(`No field was given, so the first group (${field.label}, the highest-priced humanities and business cluster) is shown; every field's amount is in extra.all_fields.`);
  if (year < now.getUTCFullYear()) caveats.push(`These are the ${year} amounts; newer rates are in force.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "AU", cycle, student_group: group, study_mode: mode, field: field.id, commenced, year },
    value,
    measure: "average",
    currency: "AUD",
    unit: "per EFTSL (one full-time year of study), maximum student contribution",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method:
      "Australia tuition: the maximum student contribution the Department of Education publishes for Commonwealth supported places, per EFTSL (one full-time year), " +
      "for the chosen field group and start-date group, in Australian dollars for the calendar year. We pass on the published amount and its year; " +
      "it is a statutory maximum (a posted figure), not payments by sampled students, with no range or sample size.",
    describe: (v) =>
      `In ${year}, the maximum student contribution for ${field.label} (funding cluster ${field.cluster}) for ${who} in a Commonwealth supported place in Australia is ${dollars(v)} per full-time year` +
      `${change !== null ? ` (${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${prev!.year})` : ""}.`,
    note: caveats.join(" "),
    baseUrl: input.baseUrl,
    extra: {
      place: "Australia",
      academic_year: String(year),
      field_group: field.id,
      field_label: field.label,
      funding_cluster: field.cluster,
      commenced,
      fee_basis: "maximum student contribution per EFTSL, Commonwealth supported places, calendar year",
      change_on_previous_year: prev && prevValue ? { year: prev.year, value: prevValue, percent: change } : null,
      all_fields: FIELDS.map((f) => ({ field_group: f.id, label: f.label, funding_cluster: f.cluster, value: table[f.id] })),
      fee_free_uni_ready: rates.uniReady,
      source_table_url: rates.url,
      available_years: known,
      attribution_notice: INFO.attribution,
    },
  });
}
