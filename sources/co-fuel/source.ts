// Colombia fuel: monthly average posted price of vehicular natural gas (GNCV, "GNV") per service station, Ministerio de Minas y Energia (SICOM).
// Dataset he3q-86dn on datos.gov.co (Socrata). Format checked live on 2026-10-29 from GitHub's servers (probes cofuel-e1..e4):
//   GET https://www.datos.gov.co/resource/he3q-86dn.json?$where=anio_precio='2026'  -> JSON array of strings, one row per station and month:
//   { fecha_precio:"2026-10-01" (month start; months are NOT zero-padded in older rows: "2026-9-01"), anio_precio:"2026", mes_precio:"10",
//     departamento_eds, municipio_eds, nombre_comercial_eds, precio_promedio_publicado:"3661" (COP per cubic metre), tipo_combustible:"GNCV", ... }
//   The newest month on 2026-10-29 is 2026-10 (174 stations). fecha_precio is TEXT, so sorting by it puts "2026-9-01" after "2026-10-01":
//   the newest month is found by comparing year and month as numbers.
// Only CNG is in this dataset. Liquid fuels (gasoline, ACPM diesel) are not published on datos.gov.co in a current dataset.
// Licence: Creative Commons Attribution-ShareAlike 4.0 (publisher's Socrata metadata, read 2026-10-24). Whether we may sell aggregates under
// ShareAlike is undecided: free tier only (Simon, 29 Oct 2026).

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { MIN_PUBLISH, summarise } from "../../lib/stats";

export const DATASET = "he3q-86dn";
const BASE = `https://www.datos.gov.co/resource/${DATASET}.json`;
export const PAGE_URL = "https://www.datos.gov.co/d/he3q-86dn";
export const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/legalcode";

export const INFO: SourceInfo = {
  id: "co-fuel",
  country: "CO (Colombia)",
  category: "fuel (posted natural-gas pump prices, CNG only)",
  name: "SICOM: monthly average price of vehicular natural gas (GNCV) per service station, Colombia",
  publisher: "Ministerio de Minas y Energia (MinEnergia), SICOM, via datos.gov.co",
  what_is_recorded:
    "For each service station that reports, the average price it posted in a month for compressed natural gas for vehicles (GNCV, 'GNV'), in Colombian pesos (COP) per cubic metre.",
  price_type: "posted_pump_price",
  freshness: "One figure per station per month, published at the start of the month; the answer states the month",
  licence: "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0). Free tier only until the share-alike question is decided",
  licence_url: LICENCE_URL,
  attribution: "Fuente: Ministerio de Minas y Energía - MinEnergía (SICOM), datos.gov.co, CC BY-SA 4.0. Medians and ranges are calculated by ProofPrice from the station figures.",
  homepage: PAGE_URL,
  limits:
    "Natural gas for vehicles (CNG) only: no gasoline, no diesel, no LPG. Prices are per cubic metre (not per kg or litre). A posted monthly average per station, not what each customer paid. " +
    "Only stations that report appear (about 150 to 210 a month); an area with fewer than 5 stations gets no figure.",
};

export const MIN_COP = 1000;
export const MAX_COP = 15000;

export interface Station { year: number; month: number; department: string; municipality: string; price: number }

/** Accent-free, upper-case, punctuation-free key: "Bogotá, D.C." -> "BOGOTA DC". */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export const monthDate = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;

/** Pure: the newest (year, month) of a grouped listing [{anio_precio, mes_precio}], compared as numbers. Throws when there are none. */
export function newestMonth(rows: unknown): { year: number; month: number } {
  if (!Array.isArray(rows)) throw new SourceError("datos.gov.co returned an unexpected answer for the list of months; this source needs updating.");
  let best: { year: number; month: number } | null = null;
  for (const r of rows as any[]) {
    const year = Number(r?.anio_precio);
    const month = Number(r?.mes_precio);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000) continue;
    if (!best || year * 12 + month > best.year * 12 + best.month) best = { year, month };
  }
  if (!best) throw new SourceError("The Colombian CNG price dataset lists no months; this source needs updating.");
  return best;
}

/** Pure: station rows of one month. Prices outside COP 1,000 to 15,000 per m3 are dropped (typing errors, zeros). Throws when the layout is not the one we know. */
export function parseStations(json: unknown): Station[] {
  if (!Array.isArray(json)) throw new SourceError("datos.gov.co returned an unexpected answer (not a list of rows); this source needs updating.");
  const out: Station[] = [];
  for (const r of json as any[]) {
    if (!r || typeof r !== "object") continue;
    if (String(r.tipo_combustible ?? "").toUpperCase() !== "GNCV") continue;
    const price = Number(r.precio_promedio_publicado);
    const year = Number(r.anio_precio);
    const month = Number(r.mes_precio);
    const department = norm(String(r.departamento_eds ?? ""));
    const municipality = norm(String(r.municipio_eds ?? ""));
    if (!Number.isInteger(year) || !Number.isInteger(month) || !department || !municipality) continue;
    if (!(price >= MIN_COP && price <= MAX_COP)) continue;
    out.push({ year, month, department, municipality, price });
  }
  if (json.length && !out.length && "departamento_eds" in ((json[0] as any) ?? {}) === false) {
    throw new SourceError("The Colombian CNG price dataset changed its columns; this source needs updating.");
  }
  return out;
}

type Fetcher = (url: string) => Promise<unknown>;
const defaultFetcher: Fetcher = (u) => fetchJson(u, { headers: { accept: "application/json", "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } }, 30000);

export const monthsUrl = () => `${BASE}?$select=${encodeURIComponent("anio_precio,mes_precio,count(*) as n")}&$group=${encodeURIComponent("anio_precio,mes_precio")}&$limit=1000`;
export const stationsUrl = (year: number, month: number) =>
  `${BASE}?$where=${encodeURIComponent(`anio_precio='${year}' AND mes_precio='${month}'`)}&$limit=5000`;

/** The stations of the newest month. Older rows write the month without a leading zero, so both spellings are asked for. */
export async function newestStations(fetcher: Fetcher = defaultFetcher): Promise<{ year: number; month: number; stations: Station[] }> {
  const { year, month } = newestMonth(await fetcher(monthsUrl()));
  let stations = parseStations(await fetcher(stationsUrl(year, month)));
  if (!stations.length && month < 10) stations = parseStations(await fetcher(stationsUrl(year, Number("0" + month))));
  stations = stations.filter((s) => s.year === year && s.month === month);
  return { year, month, stations };
}

// ---------- scope: whole country, a department, or a municipality ----------

export interface Scope { kind: "country" | "department" | "municipality"; key: string; label: string }

const COUNTRY_WORDS = new Set(["", "CO", "COLOMBIA", "ALL", "NATIONAL", "COUNTRY"]);
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** area = department ("Antioquia", "Valle del Cauca"), town = municipality ("Medellin"); both empty = the whole country. */
export function resolveScope(input: { area?: string; town?: string }, stations: Station[]): Scope {
  const town = norm(input.town ?? "");
  const area = norm(input.area ?? "");
  if (town && !COUNTRY_WORDS.has(town)) {
    const key = stations.find((s) => s.municipality === town)?.municipality ?? stations.find((s) => s.municipality.startsWith(town + " ") || s.municipality.split(" ")[0] === town)?.municipality ?? town;
    return { kind: "municipality", key, label: titleCase(key) };
  }
  if (area && !COUNTRY_WORDS.has(area)) {
    const key = stations.find((s) => s.department === area)?.department ?? stations.find((s) => s.department.startsWith(area + " "))?.department ?? area;
    return { kind: "department", key, label: titleCase(key) };
  }
  return { kind: "country", key: NATIONAL, label: "Colombia" };
}

export const METHOD =
  "Colombia (fuel): the Ministry of Mines and Energy (SICOM) publishes, for each service station, the average price it posted in the month for vehicular natural gas (GNCV) in pesos per cubic metre. " +
  "We take the newest month, count each station once, and give the median and the 10th to 90th percentile across stations; an area needs at least 5 stations. Natural gas only: the dataset has no gasoline or diesel.";

export interface CoFuelInput { fuel?: string; area?: string; town?: string; postcode?: string; baseUrl?: string }

export function fuelError(fuel?: string) {
  return new InputError(
    `Colombia: only natural gas for vehicles is available (fuel=methane, COP per cubic metre)${fuel ? `, not '${fuel}'` : ""}. SICOM publishes no current gasoline or diesel price list on datos.gov.co.`,
  );
}

const cop = (v: number) => `COP ${Math.round(v).toLocaleString("en-US")}`;

/** Pure: the answer for one scope from the stations of one month. */
export function answerFromStations(stations: Station[], year: number, month: number, input: CoFuelInput): PriceAnswer {
  if (input.fuel !== "methane") throw fuelError(input.fuel);
  const scope = resolveScope(input, stations);
  const inScope = stations.filter((s) => scope.kind === "country" || (scope.kind === "department" ? s.department === scope.key : s.municipality === scope.key));
  const summary = summarise(inScope.map((s) => s.price));
  const date = monthDate(year, month);
  const ym = date.slice(0, 7);
  const notes = [] as string[];
  if (input.postcode) notes.push("Postcode is not used: SICOM gives the municipality and department of each station.");
  return buildAnswer({
    source: INFO,
    query: { country: "CO", fuel: "methane", ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}) },
    summary,
    currency: "COP",
    unit: "per cubic metre",
    period: { from: date, to: date },
    method: METHOD,
    published: date,
    baseUrl: input.baseUrl,
    describe: (s) =>
      `The median posted price of vehicular natural gas (GNCV) at service stations in ${scope.label} for ${ym} is ${cop(s.median)} per cubic metre ` +
      `(typical ${cop(s.low)} to ${cop(s.high)}).`,
    extra: {
      country_name: "Colombia",
      fuel: { requested: "methane", label: "Compressed natural gas for vehicles (GNCV)" },
      price_unit_note: "Pesos per cubic metre of gas, not per kg.",
      scope: { kind: scope.kind, label: scope.label },
      month: ym,
      stations_in_dataset_this_month: stations.length,
      what_this_is: "Average price each station posted for the month, as reported to SICOM. Natural gas only. Not a transaction price.",
      ...(notes.length ? { notes } : {}),
    },
  });
}

export async function coFuel(input: CoFuelInput, fetcher: Fetcher = defaultFetcher): Promise<PriceAnswer> {
  if (input.fuel !== "methane") throw fuelError(input.fuel);
  const { year, month, stations } = await newestStations(fetcher);
  return answerFromStations(stations, year, month, input);
}

// ---------- daily collector ----------

/** Library rows: the whole country ("ALL"), each department ("dep:ANTIOQUIA") and each municipality ("mun:MEDELLIN") with at least 5 stations. Date = first day of the month. */
export function harvestFromStations(stations: Station[], year: number, month: number): HarvestResult {
  if (stations.length < MIN_PUBLISH) throw new SourceError(`Only ${stations.length} usable stations for ${year}-${month}; expected well over 5.`);
  const natl = aggregateDaily(stations.map((s) => ({ area: NATIONAL, item: "methane", price: s.price })), false);
  const dep = aggregateDaily(stations.map((s) => ({ area: `dep:${s.department}`, item: "methane", price: s.price })), false);
  const mun = aggregateDaily(stations.map((s) => ({ area: `mun:${s.municipality}`, item: "methane", price: s.price })), false);
  const rows = [...natl, ...dep, ...mun].filter((r) => r.n >= MIN_PUBLISH);
  return {
    date: monthDate(year, month),
    currency: "COP",
    unit: "per cubic metre",
    rows,
    note: "SICOM monthly average posted price of vehicular natural gas (GNCV) per station, COP per m3; one row per month (dated the first of the month), national, department (dep:) and municipality (mun:) with at least 5 stations.",
  };
}

export async function coHarvest(fetcher: Fetcher = defaultFetcher): Promise<HarvestResult> {
  const { year, month, stations } = await newestStations(fetcher);
  return harvestFromStations(stations, year, month);
}

export function coHistoryKey(p: { fuel?: string; area?: string; town?: string }): { area: string; item: string; label: string } | null {
  if (p.fuel !== "methane") return null;
  const town = norm(p.town ?? "");
  const area = norm(p.area ?? "");
  if (town && !COUNTRY_WORDS.has(town)) return { area: `mun:${town}`, item: "methane", label: `${titleCase(town)} (CNG, SICOM)` };
  if (area && !COUNTRY_WORDS.has(area)) return { area: `dep:${area}`, item: "methane", label: `${titleCase(area)} (CNG, SICOM)` };
  return { area: NATIONAL, item: "methane", label: "Colombia (CNG, SICOM)" };
}
