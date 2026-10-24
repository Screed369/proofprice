// France: commercial premises and land sale prices from DVF (Demandes de valeurs foncières, DGFiP), using Etalab's
// per-commune geo-dvf files (the same files as sources/fr-dvf). Aggregates only: never addresses or parcels.
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { arrondissementsOf, findArrondissementByPostcode, findCity, FR_ARRONDISSEMENTS, FR_CITIES, norm } from "../fr-dvf/places";

export const INFO: SourceInfo = {
  id: "fr-dvf-commercial",
  country: "FR",
  category: "commercial property and land",
  name: "Demandes de valeurs foncières (DVF), geo-dvf per-commune files: commercial premises and land",
  publisher: "Direction générale des Finances publiques (DGFiP), files prepared by Etalab",
  what_is_recorded: "Property sales recorded by French land registries: date, nature, price, type of premises, built surface, land surface.",
  price_type: "transaction",
  freshness: "Twice a year, with a delay of several months",
  licence: "Licence Ouverte / Etalab 2.0, plus the DVF reuse conditions (no re-identification of people; raw data not to be indexed by search engines)",
  licence_url: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/",
  attribution: "Source: DGFiP, Demandes de valeurs foncières (DVF), via geo-dvf (Etalab), Licence Ouverte 2.0.",
  homepage: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres-geolocalisees/",
  limits:
    "We return aggregates only (median, range, count), never addresses or parcels. Alsace-Moselle (departments 57, 67, 68) and Mayotte are not covered by DVF. " +
    "Commercial: plain sales of exactly one commercial or industrial unit (with or without outbuildings or land), never together with a home; the price per m² divides the whole declared price by the built floor area, so land or outbuildings sold in the same deed raise it. " +
    "Land: plain sales of ground with no building (cadastral type 'sols', i.e. building plots and other non-farm ground); farmland, forests and meadows are left out; the price per m² divides the whole price by the land area. " +
    "DVF is published twice a year with a delay of several months, so the latest months are missing.",
};

const DVF_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv/";
const GEO_API = "https://geo.api.gouv.fr/communes";
const CITY_WITH_ARRONDISSEMENTS = new Set(["75056", "69123", "13055"]); // Paris, Lyon, Marseille
const UA = { "user-agent": "pricepaid-plug/0.1" };

export const FR_COMMERCIAL_TYPES = ["commercial", "land"] as const;
export type FrCommercialType = (typeof FR_COMMERCIAL_TYPES)[number];

/** Sanity limits: below these a record is almost always a data artefact (share of a lot, parking, portfolio deal). */
export const LIMITS = { minPrice: 10_000, maxPrice: 20_000_000, minSurface: 10, maxPerSqm: 100_000, minPerSqmLand: 1 };

export interface Commune {
  code: string;
  nom: string;
  codeDepartement: string;
}

/** Minimal RFC 4180 CSV parser (handles quotes and commas inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface DvfSale {
  id: string;
  date: string;
  price: number; // whole declared price of the sale
  surface: number; // built floor area (commercial) or land area (land), m²
  perSqm: number;
}

interface Group {
  date: string;
  nature: string;
  price: number;
  commercial: number; // rows with code_type_local 4
  homes: number; // rows with code_type_local 1 or 2
  otherLocal: boolean; // anything else that is a building and not a dependance
  anyLocal: boolean; // any row with a building type at all (dependances included)
  surface: number;
  landSurface: number;
  landSols: number; // land rows of cadastral type S
  landOther: number; // land rows of any other type (farmland, forest, meadow...)
}

function groupMutations(rows: string[][]): Map<string, Group> {
  if (rows.length < 2) return new Map();
  const h = rows[0];
  const ix = (n: string) => h.indexOf(n);
  const iId = ix("id_mutation"), iDate = ix("date_mutation"), iNat = ix("nature_mutation"), iVal = ix("valeur_fonciere");
  const iCode = ix("code_type_local"), iSurf = ix("surface_reelle_bati"), iNc = ix("code_nature_culture"), iTer = ix("surface_terrain");
  if ([iId, iDate, iNat, iVal, iCode, iSurf, iNc, iTer].some((i) => i < 0)) throw new SourceError("Unexpected DVF file layout");
  const groups = new Map<string, Group>();
  for (const r of rows.slice(1)) {
    const id = r[iId];
    if (!id) continue;
    let g = groups.get(id);
    if (!g) {
      g = { date: r[iDate], nature: r[iNat], price: Number(r[iVal]), commercial: 0, homes: 0, otherLocal: false, anyLocal: false, surface: 0, landSurface: 0, landSols: 0, landOther: 0 };
      groups.set(id, g);
    }
    const code = r[iCode];
    if (code) g.anyLocal = true;
    if (code === "4") {
      g.commercial++;
      g.surface += Number(r[iSurf]) || 0;
    } else if (code === "1" || code === "2") g.homes++;
    else if (code && code !== "3") g.otherLocal = true;
    const terrain = Number(r[iTer]) || 0;
    const nc = r[iNc];
    if (!code && nc) {
      if (nc === "S") {
        g.landSols++;
        g.landSurface += terrain;
      } else g.landOther++;
    }
  }
  return groups;
}

/**
 * One sale per mutation. Commercial: a plain "Vente" with exactly one commercial/industrial unit and no home.
 * Land: a plain "Vente" with no building at all, only ground of cadastral type S ("sols"), summed over its parcels.
 */
export function dvfCommercialSales(rows: string[][], type: FrCommercialType): DvfSale[] {
  const out: DvfSale[] = [];
  for (const [id, g] of groupMutations(rows)) {
    if (g.nature !== "Vente" || !Number.isFinite(g.price)) continue;
    if (g.price < LIMITS.minPrice || g.price > LIMITS.maxPrice) continue;
    let surface: number;
    if (type === "commercial") {
      if (g.commercial !== 1 || g.homes > 0 || g.otherLocal) continue;
      surface = g.surface;
    } else {
      if (g.anyLocal || g.landOther > 0 || g.landSols === 0) continue;
      surface = g.landSurface;
    }
    if (!(surface >= LIMITS.minSurface)) continue;
    const perSqm = g.price / surface;
    if (perSqm > LIMITS.maxPerSqm || perSqm < LIMITS.minPerSqmLand) continue;
    out.push({ id, date: g.date, price: g.price, surface, perSqm });
  }
  return out;
}

/** Communes for a postcode or town we know by heart (arrondissements of Paris, Lyon, Marseille and the big cities): no geo API call. */
export function knownCommunes(input: { postcode?: string; town?: string }): Commune[] | null {
  if (input.postcode) {
    const a = findArrondissementByPostcode(input.postcode);
    return a ? [{ code: a.code, nom: a.name, codeDepartement: a.dep }] : null;
  }
  if (input.town) {
    const c = findCity(input.town);
    if (!c) return null;
    const arr = arrondissementsOf(c.code);
    if (arr.length) return arr.map((a) => ({ code: a.code, nom: a.name, codeDepartement: a.dep }));
    return [{ code: c.code, nom: c.name, codeDepartement: c.dep }];
  }
  return null;
}

// The geo API and the DVF files are slow from Vercel: two attempts of 12 s each stay inside the answer deadline.
const geoJson = <T>(url: string): Promise<T> => retryOnce(() => fetchJson(url, {}, 12000)) as Promise<T>;

export async function resolveCommunes(input: { postcode?: string; town?: string }): Promise<Commune[]> {
  const known = knownCommunes(input);
  if (known) return known;
  const fields = "fields=nom,code,codeDepartement";
  if (input.postcode) {
    const cp = input.postcode.replace(/\D/g, "").slice(0, 5);
    if (cp.length !== 5) throw new InputError("A French postcode must have 5 digits.");
    let list: Commune[] = await geoJson(`${GEO_API}?codePostal=${cp}&${fields}`);
    if (list.some((c) => CITY_WITH_ARRONDISSEMENTS.has(c.code))) {
      const arr: Commune[] = await geoJson(`${GEO_API}?codePostal=${cp}&type=arrondissement-municipal&${fields}`);
      list = [...list.filter((c) => !CITY_WITH_ARRONDISSEMENTS.has(c.code)), ...arr];
    }
    return list;
  }
  if (input.town) {
    const list: Commune[] = await geoJson(`${GEO_API}?nom=${encodeURIComponent(input.town)}&${fields}&boost=population&limit=1`);
    if (list[0] && CITY_WITH_ARRONDISSEMENTS.has(list[0].code)) {
      const arr: Commune[] = await geoJson(`${GEO_API}?nom=${encodeURIComponent(input.town)}&type=arrondissement-municipal&${fields}&limit=30`);
      return arr.filter((a) => a.code.startsWith(list[0].codeDepartement));
    }
    return list.slice(0, 1);
  }
  throw new InputError("Give a French postcode or town.");
}

let yearsCache: { at: number; years: number[] } | null = null;
/** GET with a hard timeout (a hung connection would otherwise use up the whole answer deadline). */
async function getText(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: UA, redirect: "follow", signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

async function dvfYears(): Promise<number[]> {
  if (yearsCache && Date.now() - yearsCache.at < 6 * 3600 * 1000) return yearsCache.years;
  const res = await retryOnce(() => getText(DVF_BASE, 12000));
  if (!res.ok) throw new SourceError(`DVF index returned HTTP ${res.status}`);
  const html = await res.text();
  const years = [...new Set([...html.matchAll(/(20\d{2})\//g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (!years.length) throw new SourceError("Could not read the DVF year list");
  yearsCache = { at: Date.now(), years };
  return years;
}

async function fetchCommuneCsv(year: number, c: Commune): Promise<string[][]> {
  const res = await retryOnce(() => getText(`${DVF_BASE}${year}/communes/${c.codeDepartement}/${c.code}.csv`, 12000));
  if (res.status === 404) return [];
  if (!res.ok) throw new SourceError(`DVF file returned HTTP ${res.status}`);
  return parseCsv(await res.text());
}

export function windowSales(sales: DvfSale[], months: number): { kept: DvfSale[]; from: string | null; to: string | null } {
  if (!sales.length) return { kept: [], from: null, to: null };
  const latest = sales.map((s) => s.date).sort().at(-1)!;
  const start = new Date(latest + "T00:00:00Z");
  start.setUTCMonth(start.getUTCMonth() - months);
  const from = start.toISOString().slice(0, 10);
  const kept = sales.filter((s) => s.date > from);
  return { kept, from: kept.map((s) => s.date).sort()[0] ?? null, to: latest };
}

/** The summary sentence (pure). */
export function frCommercialDescribe(type: FrCommercialType, place: string, x: { median: number; low: number; high: number }, to: string | null): string {
  const what = type === "commercial" ? "Commercial premises (shops, offices, workshops)" : "Building plots and other non-farm land";
  return (
    `${what} in ${place} sold for a median of ${fmtMoney(x.median, "EUR")} per m²; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} per m². ` +
    `DVF is published with a delay of several months, so the latest sale included is from ${to}.`
  );
}

export async function frCommercial(input: {
  postcode?: string;
  town?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "commercial").toLowerCase() as FrCommercialType;
  if (!FR_COMMERCIAL_TYPES.includes(type)) throw new InputError(`property_type must be one of: ${FR_COMMERCIAL_TYPES.join(", ")} for France`);
  const months = Math.max(1, Math.min(36, Math.round(input.months ?? 24)));
  const communes = await resolveCommunes(input);
  if (!communes.length) throw new InputError("No French commune found for that postcode or town.");
  if (communes.length > 25) throw new InputError("That area covers too many communes; give a postcode instead.");
  const nYears = Math.min(3, Math.ceil(months / 12) + 1);
  const years = (await dvfYears()).slice(-nYears);
  const files = await Promise.all(years.flatMap((y) => communes.map((c) => fetchCommuneCsv(y, c))));
  const sales = files.flatMap((f) => dvfCommercialSales(f, type));
  const { kept, from, to } = windowSales(sales, months);
  const s = summarise(kept.map((x) => x.perSqm));
  const place = input.postcode ? `postcode ${input.postcode}` : communes.length === 1 ? communes[0].nom : input.town!;
  const whole = s && s.count >= 5 ? summarise(kept.map((x) => x.price)) : null;
  return buildAnswer({
    source: INFO,
    query: { country: "FR", postcode: input.postcode ?? null, town: input.town ?? null, property_type: type, months },
    summary: s,
    currency: "EUR",
    unit: "per m²",
    period: { from, to },
    method:
      `Median and 10th–90th percentile of the price per m² of sales recorded in DVF for the commune(s), over the latest ${months} months available. ` +
      (type === "commercial"
        ? "Only plain sales ('Vente') of exactly one commercial or industrial unit are counted (no homes in the same deed); the whole declared price is divided by the built floor area. "
        : "Only plain sales ('Vente') of ground with no building are counted (cadastral type 'sols'; farmland and forest are left out); the whole price is divided by the land area. ") +
      `Records under ${LIMITS.minPrice.toLocaleString("en")} EUR, over ${LIMITS.maxPrice.toLocaleString("en")} EUR, under ${LIMITS.minSurface} m² or over ${LIMITS.maxPerSqm.toLocaleString("en")} EUR/m² are dropped as data artefacts. DVF is published with a delay of several months.`,
    describe: (x) => frCommercialDescribe(type, place, x, to),
    baseUrl: input.baseUrl,
    extra: {
      communes: communes.map((c) => ({ code: c.code, name: c.nom })),
      ...(whole ? { median_sale_price: whole.median, sale_price_note: "Median whole declared price of the same sales, in EUR (not per m²)." } : {}),
      data_lag_note: "DVF is updated twice a year; the most recent months are not yet included. Alsace-Moselle (57, 67, 68) and Mayotte are not in DVF.",
    },
  });
}


// ---------- daily collector (stale-if-error copy and /history) ----------
// DVF changes twice a year, but files.data.gouv.fr is slow or down at times. Once a day the collector (GitHub Actions) stores the
// 24-month median price per m² of commercial premises and of land for the arrondissements of Paris, Lyon and Marseille and for
// the biggest cities. Rows are dated by the newest sale in DVF (referenceDates), so a copy keeps standing in for a live answer
// for 7 days after the last good collection. Aggregates of 5+ sales only.

export const HARVEST_MONTHS = 24;
export const harvestItem = (t: FrCommercialType) => `${t}:${HARVEST_MONTHS}m`;

/** Library key for a request, or null when the copy cannot answer it (unknown place, other window). */
export function frHistoryKey(p: { postcode?: string; town?: string; property_type?: string; months?: number }): { area: string; item: string; label: string } | null {
  const type = (p.property_type ?? "commercial").trim().toLowerCase() || "commercial";
  if (!(FR_COMMERCIAL_TYPES as readonly string[]).includes(type)) return null;
  if (p.months !== undefined && p.months !== null && Number(p.months) !== HARVEST_MONTHS) return null;
  const item = harvestItem(type as FrCommercialType);
  if (p.postcode) {
    const a = findArrondissementByPostcode(p.postcode);
    return a ? { area: a.code, item, label: a.name } : null;
  }
  if (p.town) {
    const c = findCity(p.town);
    return c ? { area: c.code, item, label: c.name } : null;
  }
  return null;
}

export type CommuneCsvFetcher = (year: number, c: Commune) => Promise<string[][]>;

export async function frHarvest(o: { fetchCsv?: CommuneCsvFetcher; years?: number[] } = {}): Promise<HarvestResult> {
  const years = (o.years ?? (await dvfYears())).slice(-3);
  const fetchCsv = o.fetchCsv ?? fetchCommuneCsv;
  const communes = new Map<string, { c: Commune; expect: string }>();
  for (const a of FR_ARRONDISSEMENTS) communes.set(a.code, { c: { code: a.code, nom: a.name, codeDepartement: a.dep }, expect: a.name });
  for (const city of FR_CITIES) if (!arrondissementsOf(city.code).length) communes.set(city.code, { c: { code: city.code, nom: city.name, codeDepartement: city.dep }, expect: city.name });
  // Per commune: the files (kept so cities with arrondissements can be summed up) reduced to sales of each type.
  const salesBy = new Map<string, Record<FrCommercialType, DvfSale[]>>();
  const skipped: string[] = [];
  const list = [...communes.values()];
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(
      list.slice(i, i + 6).map(async ({ c, expect }) => {
        const files = await Promise.all(years.map((y) => retryOnce(() => fetchCsv(y, c))));
        const hi = files.find((f) => f.length > 1);
        const nameCol = hi ? hi[0].indexOf("nom_commune") : -1;
        if (hi && nameCol >= 0 && !norm(hi[1][nameCol]).startsWith(norm(expect).replace(/ arrondissement$/, ""))) {
          skipped.push(`${c.code} (${hi[1][nameCol]})`);
          return;
        }
        salesBy.set(c.code, { commercial: files.flatMap((f) => dvfCommercialSales(f, "commercial")), land: files.flatMap((f) => dvfCommercialSales(f, "land")) });
      }),
    );
  }
  if (!salesBy.size) throw new SourceError("DVF returned no commune files to collect");
  const rows: DailyRow[] = [];
  let newest = "";
  const add = (area: string, parts: Record<FrCommercialType, DvfSale[]>[]) => {
    for (const t of FR_COMMERCIAL_TYPES) {
      const { kept, to } = windowSales(parts.flatMap((x) => x[t]), HARVEST_MONTHS);
      const s = summarise(kept.map((x) => x.perSqm));
      if (!s || s.count < 5 || !to) continue;
      rows.push({ area, item: harvestItem(t), n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
      if (to > newest) newest = to;
    }
  };
  for (const [code, sales] of salesBy) add(code, [sales]);
  for (const city of FR_CITIES) {
    const arr = arrondissementsOf(city.code);
    if (arr.length) add(city.code, arr.map((a) => salesBy.get(a.code)).filter((x): x is Record<FrCommercialType, DvfSale[]> => !!x));
  }
  if (!rows.length || !newest) throw new SourceError("DVF files held too few commercial or land sales to collect");
  return {
    date: newest,
    currency: "EUR",
    unit: "per m²",
    rows,
    note: `DVF commercial premises and land, median EUR per m² of the latest ${HARVEST_MONTHS} months to ${newest}, ${rows.length} place/type rows (arrondissements of Paris, Lyon, Marseille and ${FR_CITIES.length - 3} cities). Aggregates of 5+ sales only.` + (skipped.length ? ` Skipped (name mismatch): ${skipped.join(", ")}.` : ""),
  };
}
