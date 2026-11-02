// Colombia property sales from the national land-registry annotations (IGAC, Registro de transacciones inmobiliarias en Colombia).
// Socrata dataset 7y2j-43cv on www.datos.gov.co. Formats checked live on 2026-10-29 through the Probe workflow (see source.test.ts):
//   one row per registry annotation (a deed act); year_radica = year of registration (text), divipola = municipality code (text), municipio/departamento
//   written in capitals WITH accents ("BOGOTÁ D.C.", "MEDELLÍN", "SANTIAGO DE CALI"), tipo_predio_zona URBANO/RURAL, nombre_natujur = act ("COMPRAVENTA" = sale),
//   tiene_valor 1 = the deed declares a value, valor = declared value in COP. The dataset was last modified 2025-04-04 and ends in 2023.
// We read only year, municipality and the declared value: never the matricula, the cadastral number, the deed text or any name.

import { socrataQuery } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const DOMAIN = "www.datos.gov.co";
export const DATASET = "7y2j-43cv";
/** Declared values below this (about USD 2,500) are mostly small plots and partial rights, not homes: left out and said so. */
export const MIN_VALUE = 10_000_000;
/** Declared values above this (about USD 5 million) are left out: almost always a typing slip or a whole estate, not a home. */
export const MAX_VALUE = 20_000_000_000;
export const PAGE_SIZE = 50_000;
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
  freshness: "The dataset ends in 2023 and was last updated on 4 April 2025: every answer states its year and is not a current market price",
  licence: "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), as stated in the publisher's metadata on datos.gov.co",
  licence_url: "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
  attribution:
    "Fuente: Instituto Geográfico Agustín Codazzi (IGAC), Registro de transacciones inmobiliarias en Colombia, datos.gov.co, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/legalcode). " +
    "Medians and ranges are ProofPrice aggregates of the published records; share-alike applies to anything built from them.",
  homepage: "https://www.datos.gov.co/Vivienda-Ciudad-y-Territorio/Registro-de-transacciones-inmobiliarias-en-Colombi/7y2j-43cv",
  limits:
    "Values are the amounts DECLARED in the deed, which can be lower than the real price. Property kind is only urban or rural: land, flats and houses are mixed. " +
    "Declared values under COP 10 million and above COP 20 billion are left out. Years 2015 to 2023 only; the file has not been updated since April 2025. Aggregates by municipality only, never a property, a deed or a person.",
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

// ---------- harvest: one pass over the registry, aggregates per municipality, type and year ----------
// The registry holds 3.7 million qualifying sales and is frozen (last modified 2025-04-04), so the collector reads it once, keeps only
// p10/median/p90/n per municipality, zone and year (never a deed, a parcel or a name), and skips the pass while the dataset is unchanged.

const SELECT = ["divipola", "municipio", "departamento", "year_radica", "tipo_predio_zona", "valor"];
export const WINDOW_YEARS = 3;
const PARALLEL_PAGES = 3;
export const BASE_WHERE = `tiene_valor = 1 AND nombre_natujur like 'COMPRAVENTA%' AND valor >= ${MIN_VALUE} AND valor < ${MAX_VALUE}`;

/** Library area key of a municipality: "5001|MEDELLÍN|ANTIOQUIA". */
export const areaKey = (c: Candidate) => `${c.divipola}|${c.municipio}|${c.departamento}`;
export function parseAreaKey(area: string): Candidate | null {
  const [divipola, municipio, departamento] = area.split("|");
  return divipola && municipio ? { divipola, municipio, departamento: departamento ?? "" } : null;
}
export const itemKey = (type: CoType, period: string | number) => `${type}:${period}`;

export interface SaleRow { divipola: string; municipio: string; departamento: string; year: number; zone: "urban" | "rural" | null; value: number }

/** Live rows (all values text) -> sales we can use. */
export function parseSales(rows: Record<string, any>[]): SaleRow[] {
  const out: SaleRow[] = [];
  for (const r of rows) {
    const year = Number(r.year_radica);
    const value = Number(r.valor);
    if (!r.divipola || !r.municipio || !Number.isFinite(year) || year < 1990 || year > 2100) continue;
    if (!Number.isFinite(value) || value < MIN_VALUE || value >= MAX_VALUE) continue;
    const z = String(r.tipo_predio_zona ?? "").toUpperCase();
    out.push({ divipola: String(r.divipola), municipio: String(r.municipio), departamento: String(r.departamento ?? ""), year, zone: z === "URBANO" ? "urban" : z === "RURAL" ? "rural" : null, value });
  }
  return out;
}

/** Collects declared values per library key (area + item); turned into rows by toRows. Memory: one number per sale and key. */
export class Bins {
  private m = new Map<string, number[]>();
  add(sale: SaleRow, items: string[]): void {
    const a = areaKey(sale);
    for (const area of [a, NATIONAL]) {
      for (const item of items) {
        const k = `${area}\u0000${item}`;
        const g = this.m.get(k);
        if (g) g.push(sale.value);
        else this.m.set(k, [sale.value]);
      }
    }
  }
  /** Rows for keys whose item matches `keep`; frees them. Keys under MIN_PUBLISH sales are dropped. */
  flush(keep: (item: string) => boolean): DailyRow[] {
    const rows: DailyRow[] = [];
    for (const [k, vals] of [...this.m]) {
      const [area, item] = k.split("\u0000");
      if (!keep(item)) continue;
      this.m.delete(k);
      const s = vals.length >= MIN_PUBLISH ? summarise(vals) : null;
      if (s) rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
    }
    return rows;
  }
}

/** Library items one sale feeds: its year, and the three-year window when it falls inside. */
export function itemsFor(sale: SaleRow, windowFrom: number): string[] {
  const types: CoType[] = sale.zone ? ["any", sale.zone] : ["any"];
  const out: string[] = [];
  for (const t of types) {
    out.push(itemKey(t, sale.year));
    if (sale.year >= windowFrom) out.push(itemKey(t, `${WINDOW_YEARS}y`));
  }
  return out;
}

export interface HarvestDeps { fetcher?: Fetcher; pageSize?: number; skipIfUnchanged?: boolean; metaFetch?: () => Promise<number | null> }

/** When the publisher last changed the rows (epoch seconds), from the portal's view metadata. */
async function rowsUpdatedAt(): Promise<number | null> {
  try {
    const res = await fetch(`https://${DOMAIN}/api/views/${DATASET}.json`, { headers: { "user-agent": "ProofPriceBot/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    return typeof j.rowsUpdatedAt === "number" ? j.rowsUpdatedAt : null;
  } catch { return null; }
}

export async function coHarvest(deps: HarvestDeps = {}): Promise<HarvestResult> {
  // Frozen dataset: when the library already holds a pass made after the publisher's last change, keep it (one pass, not one per day).
  if (deps.skipIfUnchanged !== false) {
    const meta = readMeta(INFO.id);
    const latest = readLatestDay(INFO.id);
    const changed = await (deps.metaFetch ?? rowsUpdatedAt)();
    if (meta?.last_ok_at && latest && latest.rows.length && changed !== null && Date.parse(meta.last_ok_at) / 1000 > changed) {
      const rows: DailyRow[] = latest.rows.map(({ date: _d, ...r }) => r);
      return { date: latest.date, currency: "COP", unit: "per sale", rows, note: "Registry unchanged since the last full pass; library rows kept." };
    }
  }
  const years = await socrataQuery(DOMAIN, DATASET, { select: ["year_radica", "count(*)"], where: BASE_WHERE, group: ["year_radica"], order: ["year_radica DESC"], limit: 100 }, { fetcher: deps.fetcher, timeoutMs: 120_000 });
  const yearList = [...new Set(years.map((r) => Number(r.year_radica)).filter((y) => Number.isFinite(y) && y > 1990))].sort((a, b) => b - a);
  if (!yearList.length) throw new SourceError("The Colombian registry returned no years");
  const newest = yearList[0];
  const windowFrom = newest - WINDOW_YEARS + 1;
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  const bins = new Bins();
  const rows: DailyRow[] = [];
  let sales = 0;
  for (const y of yearList) {
    // three pages at a time (deep offsets are slow on this portal; three polite requests keep the pass well inside the collector's time limit)
    for (let offset = 0, done = false; !done; offset += pageSize * PARALLEL_PAGES) {
      const pages = await Promise.all(
        Array.from({ length: PARALLEL_PAGES }, (_, i) =>
          socrataQuery(DOMAIN, DATASET, { select: SELECT, where: `${BASE_WHERE} AND year_radica = '${y}'`, order: ["pk ASC"], limit: pageSize, offset: offset + i * pageSize }, { fetcher: deps.fetcher, timeoutMs: 120_000 }),
        ),
      );
      for (const page of pages) {
        for (const s of parseSales(page)) { bins.add(s, itemsFor(s, windowFrom)); sales++; }
        if (page.length < pageSize) done = true;
      }
    }
    // a year's own items are final once its pages are read; the three-year window items wait for the older years of the window
    rows.push(...bins.flush((item) => item.endsWith(`:${y}`)));
    if (y === windowFrom) rows.push(...bins.flush((item) => item.endsWith(`:${WINDOW_YEARS}y`)));
  }
  rows.push(...bins.flush(() => true));
  if (!rows.length) throw new SourceError("The Colombian registry gave no municipality with 5 or more sales");
  return { date: `${newest}-12-31`, currency: "COP", unit: "per sale", rows, note: `${sales.toLocaleString("en-US")} registered sales with a declared value, ${yearList[yearList.length - 1]} to ${newest}; per municipality, zone and year plus the last ${WINDOW_YEARS} years.` };
}

// ---------- answers from the library ----------

/** Library key of a request (the registry needs one for every harvested source; the data is frozen, so /history is switched off by noHistory). */
export function coHistoryKey(p: { town?: string; property_type?: string }): { area: string; item: string; label: string } | null {
  const type = (p.property_type ?? "any").toLowerCase() as CoType;
  const latest = readLatestDay(INFO.id);
  if (!(TYPES as readonly string[]).includes(type) || !latest) return null;
  const place = (p.town ?? "").trim();
  const newest = Number(latest.date.slice(0, 4));
  if (!place) return { area: NATIONAL, item: itemKey(type, newest), label: "Colombia" };
  const cands = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).map(parseAreaKey).filter((c): c is Candidate => c !== null);
  try {
    const c = pickCandidate(cands, place);
    return { area: areaKey(c), item: itemKey(type, newest), label: `${titleCase(c.municipio)}, ${titleCase(c.departamento)}` };
  } catch { return null; }
}

export interface CoHomeSalesInput { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function coHomeSales(input: CoHomeSalesInput): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as CoType;
  if (!(TYPES as readonly string[]).includes(type)) throw new InputError(`property_type must be one of: ${TYPES.join(", ")} for Colombia (urban or rural land registry zone).`);
  if (input.postcode && String(input.postcode).trim()) throw new InputError("Colombia: the registry data is by municipality, so a postcode cannot narrow it. Give the municipality as town, or leave town out for the whole country.");
  const place = (input.town ?? "").trim();
  const months = input.months === undefined || !Number.isFinite(input.months) ? 12 : Math.max(1, Math.min(36, Math.round(input.months)));
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register once a day; Colombian data appears after the next collection.");
  const newest = Number(meta.last_date.slice(0, 4));
  const wantYears = Math.min(WINDOW_YEARS, Math.ceil(months / 12));

  let area = NATIONAL;
  let name = "Colombia (all registered municipalities)";
  let divipola: string | null = null;
  if (place.length > 0) {
    const cands = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).map(parseAreaKey).filter((c): c is Candidate => c !== null);
    const { town } = splitPlace(place);
    const wanted = ALIASES[normName(town)] ?? normName(town);
    const hit = cands.filter((c) => normName(c.municipio).includes(wanted) || normName(c.municipio).replace(/ D C$/, "") === wanted);
    const picked = pickCandidate(hit.length ? hit : cands, place);
    area = areaKey(picked);
    name = `${titleCase(picked.municipio)}, ${titleCase(picked.departamento)}`;
    divipola = picked.divipola;
  }
  const to = meta.last_date;
  const from = `${newest - 12}-01-01`;
  const pick = (item: string) => { const r = readDaily(INFO.id, { area, item, from, to }); return r[r.length - 1]; };
  let row: ((DailyRow & { date: string }) | undefined);
  let label = "";
  let y0 = newest, y1 = newest;
  let widened = false;
  if (wantYears >= 2) {
    const r = pick(itemKey(type, `${WINDOW_YEARS}y`));
    if (r && r.n >= MIN_PUBLISH) { row = r; y0 = newest - WINDOW_YEARS + 1; label = `${y0}–${y1}`; }
  }
  if (!row) {
    for (let y = newest; y >= newest - 8; y--) {
      const r = pick(itemKey(type, y));
      if (r && r.n >= MIN_PUBLISH) { row = r; y0 = y1 = y; label = String(y); widened = y !== newest || wantYears >= 2; break; }
    }
  }
  const kind = type === "urban" ? "urban properties" : type === "rural" ? "rural properties" : "properties (land, flats and houses together)";
  if (!row) {
    const a = buildAnswer({
      source: INFO, query: { country: "CO", town: place, property_type: type, months }, summary: null, currency: "COP", unit: "per sale",
      period: { from: null, to: null }, method: "Aggregates of the Colombian land-registry sale deeds by municipality and year.", describe: () => "", baseUrl: input.baseUrl,
      extra: { area: name, reason: `Fewer than ${MIN_PUBLISH} ${kind} sales with a declared value in ${name} in any year` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${kind} sales with a declared value are recorded in ${name}, so no price range is published (it would identify individual sales). Try a larger municipality, or leave town out for the whole country.`;
    return a;
  }
  const notes = [
    "The registry data ends in 2023 and has not been updated since April 2025: this is a past price, not today's market.",
    "Values are the amounts declared in the deed; they can be lower than the real price. Property kind is only urban or rural.",
  ];
  if (widened) notes.push(`Not enough sales in the requested window, so this uses ${label}.`);
  return buildAnswer({
    source: INFO,
    query: { country: "CO", town: place, property_type: type, months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "COP",
    unit: "per sale (declared value)",
    period: { from: `${y0}-01-01`, to: `${y1}-12-31` },
    method:
      `Median and 10th–90th percentile of the value declared in the deed for sales (COMPRAVENTA) of ${kind} registered in ${name} in ${y0 === y1 ? y0 : `${y0} to ${y1}`}, ` +
      `from the IGAC land-registry annotations on datos.gov.co, collected into our price library. Only sales that declare a value from COP ${MIN_VALUE.toLocaleString("en-US")} to under COP ${MAX_VALUE.toLocaleString("en-US")} are used; the dataset ends in 2023. ` +
      "A deed can record several parcels, and declared values can be below the true price.",
    describe: (x) =>
      `${cap(kind)} sold in ${name} declared a median of ${fmtMoney(x.median, "COP")} in the deed (${label}); 10th–90th percentile range ${fmtMoney(x.low, "COP")}–${fmtMoney(x.high, "COP")}.`,
    baseUrl: input.baseUrl,
    extra: { area: name, divipola, window: { years: y0 === y1 ? [y0] : Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i) }, dataset_ends: "2023", dataset: { name: INFO.name, url: INFO.homepage }, notes },
  });
}
