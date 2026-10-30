// Colombia regulated electricity tariff (unit cost of supply, "CU", COP per kWh) for four distribution areas, from the open dataset
// "Costo unitario de prestación del servicio de energía" on datos.gov.co (Socrata dataset ytme-6qnu).
// Format checked live on 2026-10-30 through the GitHub probe (probes bco-rows, bco-ops, bco-periods): plain GET, no key, a JSON array of
// rows with a_o (year), periodo (Spanish month name), operador_de_red, nivel, cu_total and cost components, all values as strings.
// Only four utilities appear (ENEL Bogota, EMCALI Cali, CELSIA Valle del Cauca, CELSIA Tolima), January 2024 to September 2025
// (about 400 rows in all). Operator names and level labels are spelt several ways (extra spaces, "CELSIA" and "CELSIA Colombia").
// CU is a regulated cost of supply set by the regulator's formula, a POSTED tariff component, not a bill and not an amount paid.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { socrataQuery } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "www.datos.gov.co";
export const DATASET = "ytme-6qnu";

export const INFO: SourceInfo = {
  id: "co-minenergia-tariffs",
  country: "CO (four utility areas)",
  category: "energy (regulated electricity unit cost)",
  name: "Colombia electricity unit cost of supply (CU), regulated tariff by utility",
  publisher: "Open data on datos.gov.co (Colombian government open data portal); attribution on the dataset: E.S.P. Empresas Públicas de Medellín - EPM",
  what_is_recorded:
    "The monthly regulated unit cost of supply (costo unitario, CU) of electricity in COP per kWh for four utility areas (Bogotá, Cali, Valle del Cauca, Tolima), by voltage level. A regulated tariff, not a bill.",
  price_type: "posted_price",
  freshness: "The dataset on datos.gov.co was last modified 15 July 2026 and its newest month is September 2025; each answer states its month",
  licence: "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), as stated in the dataset's metadata. Reuse conditions for our derived figures are not yet confirmed, so this source is served on the free tier only.",
  licence_url: "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
  attribution:
    "Source: datos.gov.co, \"Costo unitario de prestación del servicio de energía\" (dataset ytme-6qnu), E.S.P. Empresas Públicas de Medellín - EPM, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/legalcode).",
  homepage: "https://www.datos.gov.co/resource/ytme-6qnu.json",
  limits:
    "Only four utility areas (ENEL Bogotá, EMCALI Cali, CELSIA Valle del Cauca, CELSIA Tolima), not all of Colombia. A regulated unit cost of supply (CU) in COP per kWh, before taxes, subsidies and contributions: not a bill, not an offer and not an amount paid. " +
    "The newest month in the dataset is September 2025. Electricity only. No sample size.",
};

export const OPERATORS: Record<string, { label: string; help: string }> = {
  bogota: { label: "ENEL Bogotá - Cundinamarca", help: "ENEL Bogotá (Bogotá and Cundinamarca)" },
  cali: { label: "EMCALI - Cali", help: "EMCALI (Cali)" },
  valle: { label: "CELSIA - Valle del Cauca", help: "CELSIA Valle del Cauca" },
  tolima: { label: "CELSIA - Tolima", help: "CELSIA Tolima" },
};

const OPERATOR_ALIASES: Record<string, string> = {
  bogota: "bogota", bogotá: "bogota", enel: "bogota", cundinamarca: "bogota", "enel bogota": "bogota",
  cali: "cali", emcali: "cali",
  valle: "valle", "valle del cauca": "valle", "celsia valle": "valle", "celsia valle del cauca": "valle",
  tolima: "tolima", "celsia tolima": "tolima", ibague: "tolima", ibagué: "tolima",
};

export function normaliseOperator(raw?: string): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "bogota";
  const k = OPERATOR_ALIASES[s];
  if (!k) throw new InputError(`operator for CO must be one of bogota, cali, valle or tolima (the four utility areas in the dataset). Not yet: ${raw}.`);
  return k;
}

/** consumption_band for CO is the voltage level: "1" (households and small users, default), "2" or "3". */
export function normaliseLevel(raw?: string): "1" | "2" | "3" {
  const s = (raw ?? "").trim().toLowerCase().replace(/^(nivel|level)\s*/, "");
  if (!s || s === "standard" || s === "1" || s === "i" || s === "household") return "1";
  if (s === "2" || s === "ii") return "2";
  if (s === "3" || s === "iii") return "3";
  throw new InputError('consumption_band for CO is the voltage level: "1" (default, households and small users), "2" or "3".');
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export type Ownership = "or" | "shared" | "customer" | null;

export interface Row {
  year: number;
  month: number;
  operator: string; // key of OPERATORS
  level: "1" | "2" | "3";
  /** Level 1 only: who owns the connection assets (operator, shared or customer); null for levels 2 and 3. */
  ownership: Ownership;
  cu: number;
}

export function operatorKey(name: string): string | null {
  const s = name.toLowerCase();
  if (s.includes("enel")) return "bogota";
  if (s.includes("emcali")) return "cali";
  if (s.includes("celsia") && s.includes("valle")) return "valle";
  if (s.includes("celsia") && s.includes("tolima")) return "tolima";
  return null;
}

export function parseLevel(label: string): { level: "1" | "2" | "3"; ownership: Ownership } | null {
  const s = label.toLowerCase().replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  if (/^nivel 1\b/.test(s)) {
    const o: Ownership = /propiedad or\b/.test(s) ? "or" : /compartida/.test(s) ? "shared" : /cliente/.test(s) ? "customer" : null;
    return { level: "1", ownership: o };
  }
  if (/^nivel (ii|2)$/.test(s)) return { level: "2", ownership: null };
  if (/^nivel (iii|3)$/.test(s)) return { level: "3", ownership: null };
  return null;
}

/** Pure: rows of the dataset (strings) -> clean rows. Unknown operators, levels, months and non-positive costs are dropped. */
export function parseRows(json: unknown): Row[] {
  if (!Array.isArray(json)) throw new SourceError("datos.gov.co did not return a list of rows for the electricity unit cost; this source needs updating.");
  const out: Row[] = [];
  for (const r of json as any[]) {
    if (!r || typeof r !== "object") continue;
    const year = Number(r.a_o);
    const month = MONTHS[String(r.periodo ?? "").trim().toLowerCase()];
    const operator = operatorKey(String(r.operador_de_red ?? ""));
    const lv = parseLevel(String(r.nivel ?? ""));
    const cu = Number(r.cu_total);
    if (!Number.isFinite(year) || !month || !operator || !lv || !Number.isFinite(cu) || cu <= 0) continue;
    out.push({ year, month, operator, level: lv.level, ownership: lv.ownership, cu });
  }
  return out;
}

const ym = (r: { year: number; month: number }) => r.year * 12 + (r.month - 1);
const pad = (n: number) => String(n).padStart(2, "0");
const monthStr = (r: { year: number; month: number }) => `${r.year}-${pad(r.month)}`;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface CoInput {
  energy?: string;
  consumption_band?: string;
  operator?: string;
  baseUrl?: string;
}

export function answerFromRows(rows: Row[], input: CoInput): PriceAnswer {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("CO: only electricity is available (no gas). Use energy=electricity.");
  const op = normaliseOperator(input.operator);
  const level = normaliseLevel(input.consumption_band);
  // Level 1 headline = connection assets owned by the operator (the standard case); levels 2 and 3 have no ownership split.
  const mine = rows.filter((r) => r.operator === op && r.level === level && (level !== "1" || r.ownership === "or"));
  const query: Record<string, unknown> = { country: "CO", energy: "electricity", consumption_band: level, operator: op };
  if (!mine.length) {
    throw new SourceError(`No unit cost found for ${OPERATORS[op].help}, level ${level}, in the datos.gov.co dataset.`);
  }
  const latest = mine.reduce((a, b) => (ym(b) > ym(a) ? b : a));
  const same = mine.filter((r) => ym(r) === ym(latest));
  const cu = same[same.length - 1].cu;
  const previous = mine.filter((r) => ym(r) < ym(latest)).reduce<Row | null>((a, b) => (a === null || ym(b) > ym(a) ? b : a), null);
  const monthRows = rows.filter((r) => r.operator === op && ym(r) === ym(latest) && r.level === "1");
  const own = (o: Ownership) => monthRows.find((r) => r.ownership === o)?.cu ?? null;
  const area = OPERATORS[op].help;
  const mm = monthStr(latest);
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: cu,
    measure: "average",
    currency: "COP",
    unit: `per kWh (regulated unit cost of supply, CU, level ${level}${level === "1" ? ", operator-owned connection" : ""}, before taxes, subsidies and contributions)`,
    period: { from: `${mm}-01`, to: `${mm}-${pad(lastDay(latest.year, latest.month))}` },
    reference_period: mm,
    method:
      "Colombia electricity: the regulated unit cost of supply (CU) that the dataset on datos.gov.co lists per utility, month and voltage level, in COP per kWh. " +
      "We pass on the newest month for the chosen utility and level. A regulated tariff component (a posted price), not a bill and not an amount paid. Only four utility areas are in the dataset.",
    describe: (v) => `The regulated unit cost of electricity supply for ${area} in ${mm} (level ${level}) was COP ${v.toFixed(2)} per kWh.`,
    note: `Regulated unit cost (CU) for ${area} only, not all of Colombia; the newest month in the dataset is ${mm}.`,
    baseUrl: input.baseUrl,
    extra: {
      operator: op,
      operator_name: OPERATORS[op].label,
      level,
      month: mm,
      previous_month: previous ? monthStr(previous) : null,
      previous_cu_cop_per_kwh: previous ? r2(previous.cu) : null,
      level1_by_ownership_cop_per_kwh: level === "1" ? { operator: own("or"), shared: own("shared"), customer: own("customer") } : undefined,
      areas_available: Object.keys(OPERATORS),
    },
  });
}

export async function coElectricity(input: CoInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const energy = (input.energy ?? "electricity").toString().toLowerCase();
  if (energy !== "electricity") throw new InputError("CO: only electricity is available (no gas). Use energy=electricity.");
  normaliseOperator(input.operator);
  normaliseLevel(input.consumption_band);
  const json = await socrataQuery(DOMAIN, DATASET, { limit: 5000, order: "a_o DESC" }, fetcher ? { fetcher } : {});
  return answerFromRows(parseRows(json), input);
}
