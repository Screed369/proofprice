// France supplementary (complementary, "mutuelle") health insurance: the average monthly premium published by DREES (the statistics
// service of the French health ministry) in its biennial survey of insurers, "Enquête auprès des organismes offrant des couvertures
// complémentaires santé" (data.drees.solidarites-sante.gouv.fr, dataset enquete-oc-depuis-2019, OpenDataSoft Explore API v2.1).
// Read live with one small request (theme = "Primes": 75 rows for 2019, 2021 and 2023). Fields checked through the GitHub probe on
// 2026-10-29 (probe bd-drees-primes, fixture.json): annee, famille_d_organisme, type_de_contrat, theme, type_d_indicateur, indicateur,
// modalite, valeur (euros a month), unite. The survey publishes no record count, so the answer carries no sample size.

import { odsQuery } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "data.drees.solidarites-sante.gouv.fr";
export const DATASET = "enquete-oc-depuis-2019";
export const PAGE_URL = "https://data.drees.solidarites-sante.gouv.fr/explore/dataset/enquete-oc-depuis-2019/";
export const LICENCE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";

export const INFO: SourceInfo = {
  id: "fr-drees-supplementary",
  country: "FR (France)",
  category: "supplementary health insurance (average premium)",
  name: "Enquête auprès des organismes offrant des couvertures complémentaires santé: average monthly premium for a reference insured",
  publisher: "DREES (Ministère des Solidarités et de la Santé)",
  what_is_recorded:
    "The average monthly premium of supplementary health cover (mutuelles, insurance companies and provident institutions together, 'Ensemble'), for a reference insured: by age (individual contracts), " +
    "by household (single, couple, couple with 1 to 3 children), by income band and by price zone, for individual and for group (employer) contracts, in survey years 2019, 2021 and 2023. " +
    "One published average per profile and year; the survey publishes no number of contracts behind a figure.",
  price_type: "official_statistic",
  freshness: "Biennial: the survey years 2019, 2021 and 2023 are published (newest 2023); each answer states its survey year",
  licence:
    "Licence Ouverte / Open Licence version 2.0 (Etalab), as stated on the official data.gouv.fr record of this dataset (read 29 Oct 2026 by the Licence Checker): reuse, including commercial reuse, is allowed " +
    "if the source and the date of last update are named. The DREES portal page itself states no licence.",
  licence_url: LICENCE_URL,
  attribution:
    "Source: DREES, Ministère des Solidarités et de la Santé, Enquête OC (depuis 2019), Licence Ouverte 2.0 (Etalab). Figures are passed on as published; ProofPrice only selects and labels them. This is not an endorsement by DREES.",
  homepage: PAGE_URL,
  limits:
    "A survey average of insurers' premiums for a reference insured, not a price list, not a quote and not what one person paid. Only every second year (2019, 2021, 2023). " +
    "No number of contracts is published, so there is no sample size. 'Ensemble' = all kinds of insurer together. The 'lowest/highest income' and 'cheapest/dearest price zone' profiles describe the reference insured, as DREES defines them.",
};

export const INDIVIDUAL = "Contrats individuels";
export const GROUP = "Contrats collectifs";

export interface PremiumRow {
  year: number;
  contract: "individual" | "group";
  modalite: string;
  value: number;
}

/** Profile keys we accept and the DREES wording ('modalite') they map to. */
export const PROFILES: Record<string, string> = {
  single: "Seul et sans enfant",
  couple: "En couple et sans enfant",
  couple_1_child: "En couple et avec un enfant",
  couple_2_children: "En couple et avec deux enfants",
  couple_3_children: "En couple et avec trois enfants",
  age_20: "À 20 ans",
  age_40: "À 40 ans",
  age_60: "À 60 ans",
  age_65: "À 65 ans",
  age_75: "À 75 ans",
  age_85: "À 85 ans",
  any_age: "À tout âge",
  lowest_income: "Pour la tranche de revenus la plus faible",
  highest_income: "Pour la tranche de revenus la plus élevée",
  cheapest_area: "Dans la zone géographique avec les tarifs les plus faibles",
  dearest_area: "Dans la zone géographique avec les tarifs les plus élevés",
};

const WORDS_BY_KEY: Record<string, string> = {
  single: "a single person with no children (the survey's reference insured)",
  couple: "a couple with no children",
  couple_1_child: "a couple with one child",
  couple_2_children: "a couple with two children",
  couple_3_children: "a couple with three children",
  age_20: "a 20-year-old", age_40: "a 40-year-old", age_60: "a 60-year-old", age_65: "a 65-year-old", age_75: "a 75-year-old", age_85: "an 85-year-old",
  any_age: "an insured of any age",
  lowest_income: "the reference insured in the lowest income band",
  highest_income: "the reference insured in the highest income band",
  cheapest_area: "the reference insured in the cheapest price zone",
  dearest_area: "the reference insured in the dearest price zone",
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Turn what a caller wrote ('age 60', '60', 'couple with 2 kids', 'seul') into one of the PROFILES keys, or null. */
export function profileKey(input: string | undefined): string | null {
  if (!input) return "single";
  const t = fold(input);
  if (!t) return "single";
  if (PROFILES[t.replace(/ /g, "_")]) return t.replace(/ /g, "_");
  const age = /^(?:age |aged |a |at )?(\d{2})(?: years?| yrs?| ans| years old)?$/.exec(t);
  if (age) return PROFILES[`age_${age[1]}`] ? `age_${age[1]}` : null;
  if (/^(any|all) ages?$|^tout age$|^average age$/.test(t)) return "any_age";
  if (/^(single|alone|seul|seule|one person|adult|reference|reference insured|individual|person)( no children| without children| sans enfant)?$/.test(t)) return "single";
  const couple = /^couple(?: with| and| avec| et)?(?: (\d|no|one|two|three|zero|sans) (?:child|children|kid|kids|enfants?))?$/.exec(t);
  if (couple) {
    const n = couple[1];
    if (!n || n === "no" || n === "zero" || n === "sans" || n === "0") return "couple";
    if (n === "1" || n === "one") return "couple_1_child";
    if (n === "2" || n === "two") return "couple_2_children";
    if (n === "3" || n === "three") return "couple_3_children";
    return null;
  }
  if (/^(lowest|low|poorest)( income)?( band| bracket)?$/.test(t)) return "lowest_income";
  if (/^(highest|high|richest)( income)?( band| bracket)?$/.test(t)) return "highest_income";
  if (/^(cheapest|lowest priced|lowest price)( area| zone| price zone)?$/.test(t)) return "cheapest_area";
  if (/^(dearest|most expensive|highest priced|highest price)( area| zone| price zone)?$/.test(t)) return "dearest_area";
  return null;
}

/** Parse the OpenDataSoft rows. Keeps only 'Prime moyenne' in euros; drops rows without a positive number. */
export function parsePremiums(rows: Record<string, any>[]): PremiumRow[] {
  const out: PremiumRow[] = [];
  for (const r of rows) {
    if (r.theme !== "Primes" || r.indicateur !== "Prime moyenne" || String(r.unite ?? "").toLowerCase() !== "euros") continue;
    if (r.famille_d_organisme !== "Ensemble") continue;
    const year = Number(String(r.annee ?? "").slice(0, 4));
    const value = Number(r.valeur);
    const contract = r.type_de_contrat === INDIVIDUAL ? "individual" : r.type_de_contrat === GROUP ? "group" : null;
    if (!contract || !Number.isInteger(year) || !(value > 0) || typeof r.modalite !== "string") continue;
    out.push({ year, contract, modalite: r.modalite, value });
  }
  return out;
}

export interface Query {
  profile?: string;
  contract?: string;
  year?: number;
  baseUrl?: string;
}

const METHOD =
  "The average monthly premium of supplementary health cover that the DREES survey of insurers publishes for the chosen reference profile, contract type (individual or group) and survey year, " +
  "all insurer families together. Passed on as published; no calculation. The survey publishes no contract count.";

export function availableProfiles(rows: PremiumRow[], contract: "individual" | "group"): string[] {
  const have = new Set(rows.filter((r) => r.contract === contract).map((r) => r.modalite));
  return Object.entries(PROFILES).filter(([, m]) => have.has(m)).map(([key]) => key);
}

export function frAnswer(rows: PremiumRow[], q: Query): PriceAnswer {
  const key = profileKey(q.profile);
  if (!key) {
    throw new InputError(`profile "${q.profile}" is not known. Use one of: ${Object.keys(PROFILES).join(", ")} (for example profile=age 60, profile=couple, profile=couple 2 children).`);
  }
  const contract: "individual" | "group" = q.contract === "group" ? "group" : "individual";
  const modalite = PROFILES[key];
  const years = [...new Set(rows.filter((r) => r.contract === contract && r.modalite === modalite).map((r) => r.year))].sort((a, b) => a - b);
  const query = { country: "FR", profile: key, contract, ...(q.year ? { year: q.year } : {}) };
  const noMatch = (summary: string): PriceAnswer => {
    const none = buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "EUR", unit: "per month", period: { from: null, to: null },
      reference_period: "", method: METHOD, describe: () => "", baseUrl: q.baseUrl,
    });
    return { ...none, summary, extra: { available_profiles: availableProfiles(rows, contract), survey_years: [...new Set(rows.map((r) => r.year))].sort() } };
  };
  if (!years.length) {
    return noMatch(
      `The DREES survey publishes no ${contract === "group" ? "group (employer)" : "individual"}-contract average for ${WORDS_BY_KEY[key]}. ` +
        `For ${contract} contracts it publishes: ${availableProfiles(rows, contract).join(", ") || "nothing"}.`,
    );
  }
  const year = q.year ?? years[years.length - 1];
  const row = rows.find((r) => r.contract === contract && r.modalite === modalite && r.year === year);
  if (!row) return noMatch(`The survey has no figure for ${WORDS_BY_KEY[key]} in ${year}. Survey years with a figure: ${years.join(", ")}.`);
  const prev = [...years].reverse().filter((y) => y < year).map((y) => rows.find((r) => r.contract === contract && r.modalite === modalite && r.year === y))[0];
  const label = contract === "group" ? "group (employer-arranged)" : "individual";
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: row.value,
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method: METHOD,
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In the ${year} DREES survey of insurers, the average monthly premium of ${label} supplementary health cover for ${WORDS_BY_KEY[key]} was ${fmtMoney(v, "EUR")}.` +
      (prev ? ` In the ${prev.year} survey it was ${fmtMoney(prev.value, "EUR")}.` : "") +
      " This is a survey average across insurers, not a quote.",
    extra: { survey_years: [...new Set(rows.map((r) => r.year))].sort(), dataset: { page: PAGE_URL, theme: "Primes" } },
  });
}

// ---------- fetching ----------

const CACHE_MS = 6 * 3600 * 1000;
let cache: { at: number; rows: PremiumRow[] } | null = null;
export function clearCache() { cache = null; }

export async function loadPremiums(fetcher?: Fetcher): Promise<PremiumRow[]> {
  if (!fetcher && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const res = await odsQuery(DOMAIN, DATASET, { where: 'theme="Primes"', limit: 100 }, { fetcher, timeoutMs: 20000 });
  if (res.total > 100) throw new SourceError("The DREES survey now holds more than 100 premium rows; the source needs a paging update", PAGE_URL);
  const rows = parsePremiums(res.results);
  if (!rows.length) throw new SourceError("The DREES premium table came back without any average premium rows", PAGE_URL);
  if (!fetcher) cache = { at: Date.now(), rows };
  return rows;
}

export async function frDreesSupplementary(q: Query, o: { fetcher?: Fetcher } = {}): Promise<PriceAnswer> {
  return frAnswer(await loadPremiums(o.fetcher), q);
}
