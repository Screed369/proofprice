// France: what households were invoiced for energy-renovation works, from ADEME's survey of the FAIRE advice network
// ("Coûts des travaux de rénovation", Licence Ouverte 2.0). About 12,000 jobs reported by advisers, mostly works of 2011-2018; the
// dataset has not changed since 2020, so this is a HISTORICAL shelf, never "now". Format checked live on 2026-11-12:
//  - GET https://data.ademe.fr/data-fair/api/v1/datasets/<id>/lines?size=10000&select=<fields>&format=json -> {"total":N,"results":[{...}]}
//    (no key; size up to 10000, our largest dataset has 4,515 rows so one page holds everything; "next" is only present when there is more).
//  - datasets: chauffage (heating; field generateur, PAC = heat pump), isolation (field poste_isolation), menuiseries (windows),
//    photovoltaique (solar). Every row may carry cout_total_ht = total cost of the job in EUR EXCLUDING VAT; many rows have no cost.
//  - departement = upper-case name (e.g. "AIN"), region = short code (e.g. "BRE", "ARA"), annee_travaux = year of works (a few bad years like 216).
// We never keep or show single jobs: only a median / 10th-90th range over at least 5 jobs. No names or addresses are read.

import { fetchJson, InputError, SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const HOMEPAGE = "https://www.data.gouv.fr/datasets/couts-des-travaux-de-renovation-ecs";
export const API = "https://data.ademe.fr/data-fair/api/v1/datasets";

export const INFO: SourceInfo = {
  id: "fr-ademe-renovation",
  country: "FR (France)",
  category: "home upgrades (energy-renovation works invoiced, survey 2011-2018)",
  name: "Coûts des travaux de rénovation (enquête réseau FAIRE)",
  publisher: "ADEME (Agence de la transition écologique)",
  what_is_recorded:
    "The total cost, excluding VAT, of about 12,000 energy-renovation jobs in private homes (heating, insulation, windows, ventilation, hot water, solar PV) that advisers of the FAIRE network recorded from the household's invoice or quote, with the year of the works, the département and the region.",
  price_type: "transaction",
  freshness: "Historical: one survey, works mostly 2011-2018, data unchanged since 2020 (not updated)",
  licence: "Licence Ouverte 2.0 (Etalab): reuse including commercial use; the source and the date of the last update must be credited",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence",
  attribution:
    "Source: ADEME, Coûts des travaux de rénovation (enquête réseau FAIRE 2017-2018), Licence Ouverte 2.0, via data.ademe.fr and data.gouv.fr. Data last updated in 2020.",
  homepage: HOMEPAGE,
  limits:
    "OLD DATA: works are mostly from 2011 to 2018 and prices have risen a lot since, so this is a historical reference, not today's price. It is a survey of jobs reported by advisers (a sample, not a register of all works) and the amounts come from invoices or quotes. Costs are for the whole job and exclude VAT. No range is shown for fewer than 5 jobs.",
};

export type Measure = "heat_pump" | "solar_pv" | "attic_insulation" | "wall_insulation" | "windows" | "renovation";

export interface Plan {
  dataset: string;
  /** Field that tells the kind of work, and the values that count. null = every row of the dataset. */
  field: string | null;
  values: string[] | null;
  label: string;
}

export const ATTIC_KINDS: Record<string, string[]> = {
  loft: ["COMBLES PERDUES"],
  rafters: ["RAMPANTS"],
  sarking: ["SARKING"],
  all: ["COMBLES PERDUES", "RAMPANTS", "SARKING"],
};
export const WALL_KINDS: Record<string, string[]> = {
  external: ["ITE"],
  internal: ["ITI"],
  all: ["ITE", "ITI"],
};

/** Which dataset, field and values answer a measure (and optional job type); null when the survey has nothing for it. */
export function planFor(measure: string, kind?: string): Plan | null {
  const k = (kind ?? "").trim().toLowerCase();
  switch (measure) {
    case "heat_pump":
      return { dataset: "chauffage", field: "generateur", values: ["PAC"], label: "heat pump" };
    case "solar_pv":
      return { dataset: "photovoltaique", field: null, values: null, label: "solar panels (PV)" };
    case "windows":
      return { dataset: "menuiseries", field: null, values: null, label: "windows and doors" };
    case "attic_insulation": {
      const key = k === "" ? "loft" : k;
      if (!ATTIC_KINDS[key]) throw new InputError('dwelling_type for attic_insulation must be "loft" (default), "rafters", "sarking" or "all".');
      return { dataset: "isolation", field: "poste_isolation", values: ATTIC_KINDS[key], label: `roof/attic insulation (${key})` };
    }
    case "wall_insulation": {
      const key = k === "" ? "all" : k;
      if (!WALL_KINDS[key]) throw new InputError('dwelling_type for wall_insulation must be "external", "internal" or "all" (default).');
      return { dataset: "isolation", field: "poste_isolation", values: WALL_KINDS[key], label: `wall insulation (${key})` };
    }
    default:
      return null;
  }
}

export interface Line {
  cout_total_ht?: number | string | null;
  annee_travaux?: number | string | null;
  departement?: string | null;
  region?: string | null;
  [k: string]: unknown;
}

/** Lower-case, no accents, spaces/hyphens/apostrophes collapsed: "Côtes-d'Armor" -> "cotes d armor". */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const YEAR_MIN = 2000;
export const YEAR_MAX = 2025;

export interface Picked { costs: number[]; years: number[]; }

/** The costs (and works years) of the rows that match the plan and the area. Rows without a usable cost are skipped. */
export function pickCosts(rows: Line[], plan: Plan, area?: string): Picked {
  const want = area ? norm(area) : "";
  const costs: number[] = [];
  const years: number[] = [];
  for (const r of rows) {
    if (plan.field && plan.values && !plan.values.includes(String(r[plan.field] ?? "").toUpperCase())) continue;
    if (want && norm(String(r.departement ?? "")) !== want && norm(String(r.region ?? "")) !== want) continue;
    const c = Number(r.cout_total_ht);
    if (!Number.isFinite(c) || c <= 0) continue;
    costs.push(c);
    const y = Number(r.annee_travaux);
    if (Number.isFinite(y) && y >= YEAR_MIN && y <= YEAR_MAX) years.push(y);
  }
  return { costs, years };
}

async function fetchRows(dataset: string, fields: string[], base = API): Promise<Line[]> {
  const url = `${base}/${dataset}/lines?size=10000&format=json&select=${fields.join(",")}`;
  const j = await fetchJson(url, { headers: { Accept: "application/json" } }, 20000);
  if (!j || !Array.isArray(j.results)) throw new SourceError("ADEME renovation-cost API answered in an unexpected format; this source needs updating.");
  return j.results as Line[];
}

export interface Opts { dwelling_type?: string; area?: string; baseUrl?: string; apiBase?: string }

export async function frRenovation(measure: string, opts: Opts = {}): Promise<PriceAnswer> {
  const plan = planFor(measure, opts.dwelling_type);
  if (!plan) {
    return buildAnswer({
      source: INFO, query: { country: "FR", measure }, summary: null, currency: "EUR", unit: "per job, excl. VAT",
      period: { from: null, to: null }, method: "ADEME survey of invoiced renovation works.", describe: () => "",
      baseUrl: opts.baseUrl,
      extra: { reason: "The ADEME survey is split by kind of work (heat pump, solar_pv, attic_insulation, wall_insulation, windows); it has no figure for a general 'renovation'. Ask for one of those." },
    });
  }
  const fields = ["cout_total_ht", "annee_travaux", "departement", "region", ...(plan.field ? [plan.field] : [])];
  const rows = await fetchRows(plan.dataset, fields, opts.apiBase);
  const { costs, years } = pickCosts(rows, plan, opts.area);
  const summary = summarise(costs);
  const from = years.length ? `${Math.min(...years)}-01-01` : null;
  const to = years.length ? `${Math.max(...years)}-12-31` : null;
  return buildAnswer({
    source: INFO,
    query: { country: "FR", measure, ...(opts.dwelling_type ? { dwelling_type: opts.dwelling_type } : {}), ...(opts.area ? { area: opts.area } : {}) },
    summary, currency: "EUR", unit: "per job, excl. VAT",
    period: { from, to },
    method:
      `Median and 10th-90th percentile of the total cost excluding VAT of ${plan.label} jobs in ADEME's FAIRE survey` +
      (opts.area ? ` in ${opts.area}` : " in France") + ". Jobs from about 2011 to 2018; the cost covers the whole job, not a unit price.",
    describe: (s) =>
      `${plan.label[0].toUpperCase()}${plan.label.slice(1)} in France${opts.area ? ` (${opts.area})` : ""}: median ${s.median} EUR excl. VAT per job (typical ${s.low} to ${s.high}). HISTORICAL: jobs of ${from?.slice(0, 4) ?? "?"}-${to?.slice(0, 4) ?? "?"}.`,
    baseUrl: opts.baseUrl,
    evidence: { label: "Invoiced works in a survey (historical)", meaning: "Costs recorded by advisers from households' invoices or quotes in a one-off ADEME survey (mostly 2011-2018). A sample of jobs, not a register of all works, and not today's prices." },
    extra: { historical: true, includes_vat: false, note: "Old survey: prices have risen since; use as a historical reference only." },
  });
}
