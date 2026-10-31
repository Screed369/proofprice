// Spain high-speed rail fares from Madrid: CNMC (Comisión Nacional de los Mercados y la Competencia) "Indicador del precio medio mensual
// por trayecto" (CKAN dataset ds_24410_1 on catalogodatos.cnmc.es, datastore resource 69671e28-b299-4e45-8cf9-24d04f7e5117).
// Format checked live on 2026-10-31 (plain GET, no key): datastore_search, 1001 records in one call, fields
// _id, mes ("2022-11"), empresa (Iryo | OUIGO | Renfe-AVE | Renfe-AVLO | Total), tipo_de_servicio ("Comercial"), tipo_de_producto ("LD AV"),
// trayecto ("Madrid-Barcelona", "Madrid-Valencia", "Madrid-Alicante", "Madrid-Málaga", "Madrid-Sevilla"), precio (EUR, number). Nov 2022 to Jun 2026.
// Method (CNMC methodological note): fares observed on the operators' own websites, averaged over departure times and over the 40 days of
// advance purchase, then a simple mean of the daily values for the month. POSTED web fares, not tickets sold: there is no record count.
// Outside check done by hand on 2026-10-31: CNMC's own quarterly twin (ds_24409_1) against the mean of our three monthly values, see source.test.ts.

import { ckanSearch } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters/common";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const SITE = "https://catalogodatos.cnmc.es";
export const RESOURCE_ID = "69671e28-b299-4e45-8cf9-24d04f7e5117";

export const INFO: SourceInfo = {
  id: "es-cnmc-rail",
  country: "ES",
  category: "transport fares (Spain high-speed rail from Madrid)",
  name: "CNMC average monthly high-speed rail fare by route and operator (Madrid to Barcelona, Valencia, Alicante, Málaga, Sevilla)",
  publisher: "Comisión Nacional de los Mercados y la Competencia (CNMC), catalogodatos.cnmc.es",
  what_is_recorded:
    "The monthly average posted web fare for a one-way high-speed train ticket on five Madrid routes, per operator (Renfe AVE, Renfe AVLO, Iryo, OUIGO) and for all operators together. " +
    "CNMC observes the fares on the operators' own websites, averages over departure times and over the 40 purchase days before travel, then over the month.",
  price_type: "posted_price",
  freshness: "Monthly series, published quarterly by CNMC (newest month read on 31 Oct 2026: June 2026)",
  licence: "CC BY-SA 4.0 (CNMC condiciones de uso: reuse for commercial and non-commercial purposes, with attribution and the last-update date)",
  licence_url: "https://data.cnmc.es/condiciones-de-uso",
  attribution:
    "Origen de los datos: Comisión Nacional de los Mercados y la Competencia (CNMC), Indicador del precio medio mensual por trayecto, CC BY-SA 4.0. ProofPrice passes on the published figure; CNMC does not endorse this service.",
  homepage: "https://data.cnmc.es/transporte-y-postal/transporte/conjuntos-de-datos/indicador-del-precio-medio-mensual-por-trayecto",
  limits:
    "Posted web fares observed by CNMC, not tickets sold and not amounts paid; no sample size. Five routes out of Madrid only (high-speed, commercial services), excluding intermediaries and promo-code discounts. " +
    "An operator is missing from a month when CNMC saw no fare for it on that route.",
};

export interface Observation {
  month: string; // YYYY-MM
  operator: string; // CNMC label: "Total", "Renfe-AVE", ...
  route: string; // "Madrid-Barcelona"
  price: number;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Destination key -> CNMC route label. */
export const ROUTES: Record<string, string> = {
  barcelona: "Madrid-Barcelona",
  valencia: "Madrid-Valencia",
  alicante: "Madrid-Alicante",
  malaga: "Madrid-Málaga",
  sevilla: "Madrid-Sevilla",
};
const ROUTE_ALIASES: Record<string, string> = { seville: "sevilla", alacant: "alicante" };

/** operator key -> CNMC label */
export const OPERATORS: Record<string, string> = {
  total: "Total",
  "renfe-ave": "Renfe-AVE",
  "renfe-avlo": "Renfe-AVLO",
  iryo: "Iryo",
  ouigo: "OUIGO",
};
const OPERATOR_ALIASES: Record<string, string> = {
  all: "total", any: "total", average: "total", ave: "renfe-ave", renfe: "renfe-ave", avlo: "renfe-avlo", "renfe ave": "renfe-ave", "renfe avlo": "renfe-avlo",
};

export const DEFAULT_ROUTE = "barcelona";

/** Pure: the route key from what a person typed ("Madrid-Barcelona", "Barcelona", "Málaga", "Madrid to Seville"). Throws InputError listing the five. */
export function resolveRoute(text?: string): string {
  if (text === undefined || text.trim() === "") return DEFAULT_ROUTE;
  const t = norm(text);
  const hit = new Set<string>();
  for (const k of Object.keys(ROUTES)) if (t.includes(k)) hit.add(k);
  for (const [alias, k] of Object.entries(ROUTE_ALIASES)) if (t.includes(alias)) hit.add(k);
  if (hit.size === 1) return [...hit][0];
  throw new InputError(`route must be one of Madrid-Barcelona, Madrid-Valencia, Madrid-Alicante, Madrid-Málaga, Madrid-Sevilla (or just the destination, e.g. Barcelona); got "${text}".`);
}

/** Pure: the operator key from text; default total (all operators together). */
export function resolveOperator(text?: string): string {
  if (text === undefined || text.trim() === "") return "total";
  const t = norm(text).replace(/_/g, "-");
  if (t in OPERATORS) return t;
  const alias = OPERATOR_ALIASES[t] ?? OPERATOR_ALIASES[t.replace(/-/g, " ")];
  if (alias) return alias;
  throw new InputError('operator must be one of total (all operators, default), renfe-ave, renfe-avlo, iryo or ouigo.');
}

/** Pure: datastore records -> observations. Rows without a month, a known route or a positive price are dropped; too few rows is an error. */
export function parseObservations(records: Record<string, any>[]): Observation[] {
  const out: Observation[] = [];
  for (const r of records) {
    const month = String(r?.mes ?? "");
    const route = String(r?.trayecto ?? "");
    const operator = String(r?.empresa ?? "");
    const price = typeof r?.precio === "number" ? r.precio : Number(r?.precio);
    if (!/^\d{4}-\d{2}$/.test(month) || !operator || !Object.values(ROUTES).includes(route)) continue;
    if (!Number.isFinite(price) || price <= 0 || price > 1000) continue;
    out.push({ month, operator, route, price });
  }
  if (out.length < 100) throw new SourceError("The CNMC rail fare table has far fewer rows than expected; this source needs updating.");
  return out;
}

export const newestMonth = (obs: Observation[]): string => obs.reduce((m, o) => (o.month > m ? o.month : m), "0000-00");

const addMonths = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthEnd = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RailInput {
  route?: string;
  operator?: string;
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  baseUrl?: string;
}

const METHOD =
  "Spain high-speed rail: CNMC's monthly average posted web fare for a one-way ticket on a Madrid route, as published (EUR). CNMC reads the fares on the operators' own websites, averages over departure times and the 40 purchase days before travel, then over the month. " +
  "The headline is the newest month; the operator rows and earlier months are in extra. A posted fare indicator, not tickets sold: no sample size.";

/** Pure: answer for one route and operator from the parsed table. */
export function answerFromObservations(obs: Observation[], input: RailInput): PriceAnswer {
  if (input.fare_type !== undefined && input.fare_type !== "adult") throw new InputError("Spain rail: CNMC publishes one average web fare per route and operator, not fare groups: leave fare_type out (or adult).");
  if (input.travel_time !== undefined && input.travel_time !== "other") throw new InputError("Spain rail: CNMC averages over departure times and purchase days: leave travel_time out.");
  const routeKey = resolveRoute(input.route);
  const opKey = resolveOperator(input.operator);
  const route = ROUTES[routeKey];
  const op = OPERATORS[opKey];
  const month = newestMonth(obs);
  const series = obs.filter((o) => o.route === route && o.operator === op).sort((a, b) => a.month.localeCompare(b.month));
  const latest = series.find((o) => o.month === month);
  if (!latest) {
    const here = obs.filter((o) => o.route === route && o.month === month).map((o) => o.operator);
    throw new InputError(`CNMC has no ${op} fare on ${route} for ${month}${here.length ? `; operators with a fare that month: ${here.join(", ")}` : ""}.`);
  }
  const at = (m: string) => series.find((o) => o.month === m)?.price ?? null;
  const prev = at(addMonths(month, -1));
  const yearAgo = at(addMonths(month, -12));
  const operators = obs
    .filter((o) => o.route === route && o.month === month)
    .map((o) => ({ operator: o.operator, price_eur: round2(o.price) }))
    .sort((a, b) => (a.operator === "Total" ? -1 : b.operator === "Total" ? 1 : a.price_eur - b.price_eur));
  const single = operators.filter((o) => o.operator !== "Total");
  const prices = single.map((o) => o.price_eur);
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "ES", route, operator: op },
    value: round2(latest.price),
    measure: "average",
    currency: "EUR",
    unit: "per one-way high-speed ticket (average posted web fare for the month)",
    period: { from: `${month}-01`, to: monthEnd(month) },
    reference_period: month,
    min: opKey === "total" && prices.length >= 2 ? Math.min(...prices) : null,
    max: opKey === "total" && prices.length >= 2 ? Math.max(...prices) : null,
    method: METHOD,
    describe: (v) => `CNMC's average posted web fare for ${op === "Total" ? "all operators" : op} on ${route} in ${monthName} was EUR ${v.toFixed(2)} one way.`,
    note: "A posted fare observed on the operators' websites (average over departure times and 40 purchase days), not tickets sold. CNMC publishes the series quarterly.",
    baseUrl: input.baseUrl,
    extra: {
      route,
      operator: op,
      month,
      previous_month_eur: prev === null ? null : round2(prev),
      same_month_last_year_eur: yearAgo === null ? null : round2(yearAgo),
      operators_in_month: operators,
      last_12_months: series.slice(-12).map((o) => ({ month: o.month, price_eur: round2(o.price) })),
      available_routes: Object.values(ROUTES),
      available_operators: Object.values(OPERATORS),
    },
  });
}

export async function fetchObservations(o: FetchOptions = {}): Promise<Observation[]> {
  const r = await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 32000, includeTotal: true }, o);
  if (r.total !== null && r.records.length < r.total) throw new SourceError("The CNMC rail fare table came back incomplete; try again later.");
  return parseObservations(r.records);
}

export async function esRailFares(input: RailInput, o: FetchOptions = {}): Promise<PriceAnswer> {
  return answerFromObservations(await fetchObservations(o), input);
}

// ---------- library copy (stale-if-error and history) ----------

const opItem = (label: string) => label.toLowerCase();

/** Pure: one row per route and operator for the newest month. Rows are dated by the month's last day. */
export function harvestRows(obs: Observation[]): HarvestResult {
  const month = newestMonth(obs);
  const rows: DailyRow[] = [];
  for (const o of obs) {
    if (o.month !== month) continue;
    const key = Object.entries(ROUTES).find(([, label]) => label === o.route)?.[0];
    if (!key) continue;
    const v = round2(o.price);
    rows.push({ area: key, item: opItem(o.operator), n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  if (!rows.some((r) => r.item === "total")) throw new SourceError("CNMC rail fares: no all-operator figure for the newest month to collect");
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date: monthEnd(month), currency: "EUR", unit: "per one-way high-speed ticket (average posted web fare for the month)", rows, note: "CNMC monthly average posted web fare; no record count." };
}

export async function esRailHarvest(o: FetchOptions = {}): Promise<HarvestResult> {
  return harvestRows(await fetchObservations(o));
}

/** Library key for a request, or null when the copy cannot answer it. */
export function esRailHistoryKey(p: { route?: string; operator?: string }): { area: string; item: string; label: string } | null {
  try {
    const route = resolveRoute(p.route);
    const op = resolveOperator(p.operator);
    return { area: route, item: opItem(OPERATORS[op]), label: `${ROUTES[route]} (${OPERATORS[op]})` };
  } catch {
    return null;
  }
}
