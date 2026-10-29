// Colombia property sales from the national land-registry annotations (IGAC, Registro de transacciones inmobiliarias en Colombia).
// Socrata dataset 7y2j-43cv on www.datos.gov.co. Formats checked live on 2026-10-29 through the Probe workflow (see source.test.ts):
//   one row per registry annotation (a deed act); year_radica = year of registration (text), divipola = municipality code (text), municipio/departamento
//   written in capitals WITH accents ("BOGOTÁ D.C.", "MEDELLÍN", "SANTIAGO DE CALI"), tipo_predio_zona URBANO/RURAL, nombre_natujur = act ("COMPRAVENTA" = sale),
//   tiene_valor 1 = the deed declares a value, valor = declared value in COP. The dataset was last modified 2025-04-04 and ends in 2023.
// We read only year, municipality and the declared value: never the matricula, the cadastral number, the deed text or any name.

import { socrataAll, socrataQuery, soqlString } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const DOMAIN = "www.datos.gov.co";
export const DATASET = "7y2j-43cv";
/** Declared values below this (about USD 2,500) are mostly small plots and partial rights, not homes: left out and said so. */
export const MIN_VALUE = 10_000_000;
export const MAX_ROWS = 20_000;
export const TYPES = ["any", "urban", "rural"] as const;
export type CoType = (typeof TYPES)[number];

export const INFO: SourceInfo = {
  id: "co-igac-home-sales",
  country: "CO",
  category: "home sales",
  name: "Registro de transacciones inmobiliarias en Colombia (property sale deeds in the land registry)",
  publisher: "Instituto Geográfico Agustín Codazzi (IGAC), published on datos.gov.co",
  what_is_recorded:
    "Land-registry annotations of property transactions in 1,105 municipalities, 2015 to 2023. We read sales (COMPRAVENTA) that declare a value: the year, the municipality, urban or rural, and the value declared in the deed in Colombian pesos.",
  price_type: "transaction",
  freshness: "The dataset ends in 2023 and was last updated on 4 April 2025: every answer states its years and is not a current market price",
  licence: "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), as stated in the publisher's metadata on datos.gov.co",
  licence_url: "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
  attribution:
    "Fuente: Instituto Geográfico Agustín Codazzi (IGAC), Registro de transacciones inmobiliarias en Colombia, datos.gov.co, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/legalcode). " +
    "Medians and ranges are ProofPrice aggregates of the published records; share-alike applies to anything built from them.",
  homepage: "https://www.datos.gov.co/Vivienda-Ciudad-y-Territorio/Registro-de-transacciones-inmobiliarias-en-Colombi/7y2j-43cv",
  limits:
    "Values are the amounts DECLARED in the deed, which can be lower than the real price. Property kind is only urban or rural: land, flats and houses are mixed. " +
    "Declared values under COP 10 million are left out. Years 2015 to 2023 only; the file has not been updated since April 2025. Aggregates by municipality only, never a property, a deed or a person.",
};

// ---------- text helpers ----------

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
/** Upper case, no accents, single spaces, no dots/commas: "Bogotá, D.C." -> "BOGOTA D C". */
export function normName(s: string): string {
  return stripAccents(s).toUpperCase().replace(/[^A-Z0-9Ñ]+/g, " ").replace(/Ñ/g, "N").trim();
}

/** Well-known alternative names: everyday name -> the registry's normalised name. */
const ALIASES: Record<string, string> = {
  BOGOTA: "BOGOTA D C", "BOGOTA DC": "BOGOTA D C", "BOGOTA D C": "BOGOTA D C",
  CALI: "SANTIAGO DE CALI", CARTAGENA: "CARTAGENA DE INDIAS", "SANTA FE DE BOGOTA": "BOGOTA D C",
};

/**
 * SoQL LIKE pattern that matches a name whatever its accents: every vowel and N becomes '_' (one character), e.g. "medellin" -> "%M_D_LL_N%".
 * The registry writes capitals with accents, so a plain "MEDELLIN" would not match "MEDELLÍN".
 */
export function likePattern(name: string): string {
  const n = normName(name).replace(/ /g, "_").replace(/[AEIOUN]/g, "_");
  return `%${n}%`;
}

export interface Candidate { divipola: string; municipio: string; departamento: string }

/** The registry's own spelling for display: "BOGOTÁ D.C." -> "Bogotá D.C." */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(.-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y)\b/g, (m) => m.toLowerCase());
}

/** Parse "Town" or "Town, Department" into the two parts. */
export function splitPlace(place: string): { town: string; dept: string } {
  const parts = place.split(",").map((x) => x.trim()).filter(Boolean);
  // "Bogotá, D.C." must stay together: only treat the second part as a department when it is not "D.C."
  if (parts.length >= 2 && normName(parts[1]) !== "D C" && normName(parts[1]) !== "DC") return { town: parts[0], dept: parts.slice(1).join(" ") };
  return { town: parts.join(", "), dept: "" };
}

/** Choose the municipality: exact normalised name first, then alias, then the only candidate; otherwise ask the caller to be specific. */
export function pickCandidate(cands: Candidate[], place: string): Candidate {
  const { town, dept } = splitPlace(place);
  const wanted = ALIASES[normName(town)] ?? normName(town);
  let pool = cands;
  if (dept) {
    const d = normName(dept);
    pool = pool.filter((c) => normName(c.departamento) === d || normName(c.departamento).includes(d));
  }
  const exact = pool.filter((c) => normName(c.municipio) === wanted || normName(c.municipio).replace(/ D C$/, "") === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new InputError(`Several municipalities are called ${town}: ${exact.map((c) => `${titleCase(c.municipio)}, ${titleCase(c.departamento)}`).join("; ")}. Give town as 'Name, Department'.`);
  }
  if (pool.length === 1) return pool[0];
  if (pool.length === 0) throw new InputError(`No municipality called ${place} has property sales in the Colombian registry data. Give a municipality name such as 'Medellín' or 'Bogotá' (optionally 'Name, Department').`);
  throw new InputError(`'${place}' matches several municipalities: ${pool.slice(0, 8).map((c) => `${titleCase(c.municipio)}, ${titleCase(c.departamento)}`).join("; ")}. Give the full name, or 'Name, Department'.`);
}

// ---------- queries ----------

function zoneClause(type: CoType): string {
  return type === "urban" ? " AND tipo_predio_zona = 'URBANO'" : type === "rural" ? " AND tipo_predio_zona = 'RURAL'" : "";
}
/** Sales that declare a value of at least MIN_VALUE. */
export function baseWhere(type: CoType): string {
  return `tiene_valor = 1 AND nombre_natujur like 'COMPRAVENTA%' AND valor >= ${MIN_VALUE}${zoneClause(type)}`;
}

export interface YearCount { divipola: string; municipio: string; departamento: string; year: number; count: number }

export function parseYearCounts(rows: Record<string, any>[]): YearCount[] {
  const out: YearCount[] = [];
  for (const r of rows) {
    const year = Number(r.year_radica);
    const count = Number(r.count);
    if (!r.divipola || !r.municipio || !Number.isFinite(year) || year < 1900 || !Number.isFinite(count)) continue;
    out.push({ divipola: String(r.divipola), municipio: String(r.municipio), departamento: String(r.departamento ?? ""), year, count });
  }
  return out;
}

/** Declared values (COP) from a row list; rows without a usable value are dropped. */
export function parseValues(rows: Record<string, any>[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = Number(r.valor);
    if (Number.isFinite(v) && v >= MIN_VALUE) out.push(v);
  }
  return out;
}

/** Newest years of one municipality that together hold at least `need` sales, at most `maxYears` years back from its newest year. */
export function chooseYears(counts: YearCount[], months: number, need = 5): { years: number[]; total: number } | null {
  const sorted = [...counts].sort((a, b) => b.year - a.year);
  if (!sorted.length) return null;
  const wantYears = Math.max(1, Math.min(3, Math.ceil(months / 12)));
  const years: number[] = [];
  let total = 0;
  for (const c of sorted) {
    if (years.length >= wantYears && total >= need) break;
    if (years.length >= 3) break;
    years.push(c.year);
    total += c.count;
  }
  return total > 0 ? { years: years.sort((a, b) => a - b), total } : null;
}

export interface CoHomeSalesInput { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string }
export interface CoOptions { fetcher?: Fetcher }

export async function coHomeSales(input: CoHomeSalesInput, opts: CoOptions = {}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as CoType;
  if (!(TYPES as readonly string[]).includes(type)) throw new InputError(`property_type must be one of: ${TYPES.join(", ")} for Colombia (urban or rural land registry zone).`);
  if (input.postcode && String(input.postcode).trim()) throw new InputError("Colombia: the registry data is by municipality, so a postcode cannot narrow it. Give the municipality as town.");
  const place = (input.town ?? "").trim();
  if (place.length < 2) throw new InputError("Colombia: give the municipality as town, for example 'Medellín', 'Bogotá' or 'Cali'.");
  const months = input.months === undefined || !Number.isFinite(input.months) ? 12 : Math.max(1, Math.min(36, Math.round(input.months)));
  const { town } = splitPlace(place);

  // 1. Which municipality, and how many sales it has in each year.
  const rows = await socrataQuery(
    DOMAIN, DATASET,
    {
      select: ["divipola", "municipio", "departamento", "year_radica", "count(*)"],
      where: `${baseWhere(type)} AND municipio like ${soqlString(likePattern(ALIASES[normName(town)] ?? town))}`,
      group: ["divipola", "municipio", "departamento", "year_radica"],
      limit: 2000,
    },
    { fetcher: opts.fetcher, timeoutMs: 25000 },
  );
  const counts = parseYearCounts(rows);
  if (!counts.length) {
    return buildAnswer({
      source: INFO, query: { country: "CO", town: place, property_type: type, months }, summary: null, currency: "COP", unit: "per sale",
      period: { from: null, to: null }, method: "No sale with a declared value was found for this municipality.", describe: () => "", baseUrl: input.baseUrl,
      extra: { area: place },
    });
  }
  const cand = pickCandidate(
    [...new Map(counts.map((c) => [c.divipola, { divipola: c.divipola, municipio: c.municipio, departamento: c.departamento }])).values()],
    place,
  );
  const chosen = chooseYears(counts.filter((c) => c.divipola === cand.divipola), months);
  if (!chosen) throw new SourceError("The Colombian registry returned no years for this municipality");
  const y0 = chosen.years[0];
  const y1 = chosen.years[chosen.years.length - 1];

  // 2. The declared values of those years.
  const col = await socrataAll(
    DOMAIN, DATASET,
    {
      select: ["valor"],
      where: `${baseWhere(type)} AND divipola = ${soqlString(cand.divipola)} AND year_radica >= ${soqlString(String(y0))} AND year_radica <= ${soqlString(String(y1))}`,
      order: ["pk ASC"],
    },
    { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: 5000, timeoutMs: 25000 },
  );
  const values = parseValues(col.rows);
  const summary = summarise(values);
  const name = `${titleCase(cand.municipio)}, ${titleCase(cand.departamento)}`;
  const kind = type === "urban" ? "urban properties" : type === "rural" ? "rural properties" : "properties (land, flats and houses together)";
  const notes = [
    "The registry data ends in 2023 and has not been updated since April 2025: this is a past price, not today's market.",
    "Values are the amounts declared in the deed; they can be lower than the real price. Property kind is only urban or rural.",
  ];
  if (col.truncated) notes.push(`Result capped at ${MAX_ROWS.toLocaleString("en-US")} sales (the first by registry order); ask for fewer months for a smaller window.`);

  return buildAnswer({
    source: INFO,
    query: { country: "CO", town: place, property_type: type, months },
    summary,
    currency: "COP",
    unit: "per sale",
    period: { from: `${y0}-01-01`, to: `${y1}-12-31` },
    method:
      `Median and 10th–90th percentile of the value declared in the deed for sales (COMPRAVENTA) of ${kind} registered in ${name} in ${y0 === y1 ? y0 : `${y0} to ${y1}`}, ` +
      `from the IGAC land-registry annotations on datos.gov.co. Only sales that declare a value of at least COP ${MIN_VALUE.toLocaleString("en-US")} are used; the dataset ends in 2023. ` +
      "A deed can record several parcels, and declared values can be below the true price.",
    describe: (x) =>
      `Properties sold in ${name} declared a median of ${fmtMoney(x.median, "COP")} in the deed (${y0 === y1 ? y0 : `${y0}–${y1}`}); 10th–90th percentile range ${fmtMoney(x.low, "COP")}–${fmtMoney(x.high, "COP")}.`,
    baseUrl: input.baseUrl,
    extra: {
      area: name,
      divipola: cand.divipola,
      dataset: { name: INFO.name, url: INFO.homepage },
      window: { years: chosen.years },
      dataset_ends: "2023",
      notes,
    },
  });
}
