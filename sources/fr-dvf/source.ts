// France: home sale prices from DVF (Demandes de valeurs foncières, DGFiP), using Etalab's
// per-commune geo-dvf files. We only ever return aggregates (never addresses or parcels).
import { fetchJson, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "fr-dvf",
  country: "FR",
  category: "home sales",
  name: "Demandes de valeurs foncières (DVF), geo-dvf per-commune files",
  publisher: "Direction générale des Finances publiques (DGFiP), files prepared by Etalab",
  what_is_recorded: "Property sales recorded by French land registries: date, nature, price, type of property, built surface.",
  price_type: "transaction",
  freshness: "Twice a year, with a delay of several months",
  licence: "Licence Ouverte / Etalab 2.0, plus the DVF reuse conditions (no re-identification of people; raw data not to be indexed by search engines)",
  licence_url: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/",
  attribution: "Source: DGFiP, Demandes de valeurs foncières (DVF), via geo-dvf (Etalab), Licence Ouverte 2.0.",
  homepage: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres-geolocalisees/",
  limits:
    "We return aggregates only (median, range, count), never addresses or parcels. Alsace-Moselle and Mayotte are not covered by DVF.",
};


const DVF_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv/";
const GEO_API = "https://geo.api.gouv.fr/communes";
const CITY_WITH_ARRONDISSEMENTS = new Set(["75056", "69123", "13055"]); // Paris, Lyon, Marseille

export const FR_PROPERTY_TYPES = ["house", "apartment", "any"] as const;
export type FrPropertyType = (typeof FR_PROPERTY_TYPES)[number];
const TYPE_LABEL: Record<FrPropertyType, string> = { house: "Houses", apartment: "Apartments", any: "Homes" };
const DVF_TYPE: Record<string, FrPropertyType> = { Maison: "house", Appartement: "apartment" };

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
  price: number;
  type: FrPropertyType;
  surface: number;
}

/**
 * Turn DVF rows into one sale per mutation. A mutation can span several rows (lots, parcels, outbuildings).
 * We keep only plain sales ("Vente") of exactly one house or apartment, optionally with outbuildings or land,
 * and drop anything that also includes a commercial/industrial unit, so the price is the price of one home.
 */
export function dvfSales(rows: string[][]): DvfSale[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const ix = (n: string) => h.indexOf(n);
  const iId = ix("id_mutation"), iDate = ix("date_mutation"), iNat = ix("nature_mutation"), iVal = ix("valeur_fonciere");
  const iType = ix("type_local"), iSurf = ix("surface_reelle_bati");
  if ([iId, iDate, iNat, iVal, iType].some((i) => i < 0)) throw new SourceError("Unexpected DVF file layout");
  const groups = new Map<string, { date: string; nature: string; price: number; homes: { type: FrPropertyType; surface: number }[]; other: boolean }>();
  for (const r of rows.slice(1)) {
    const id = r[iId];
    if (!id) continue;
    let g = groups.get(id);
    if (!g) {
      g = { date: r[iDate], nature: r[iNat], price: Number(r[iVal]), homes: [], other: false };
      groups.set(id, g);
    }
    const t = r[iType];
    if (DVF_TYPE[t]) g.homes.push({ type: DVF_TYPE[t], surface: Number(r[iSurf]) || 0 });
    else if (t && t !== "Dépendance") g.other = true;
  }
  const out: DvfSale[] = [];
  for (const [id, g] of groups) {
    if (g.nature !== "Vente" || g.other || g.homes.length !== 1) continue;
    if (!Number.isFinite(g.price) || g.price < 10000) continue; // below €10k is almost always a data artefact (parking, share of a lot)
    out.push({ id, date: g.date, price: g.price, type: g.homes[0].type, surface: g.homes[0].surface });
  }
  return out;
}

export async function resolveCommunes(input: { postcode?: string; town?: string }): Promise<Commune[]> {
  const fields = "fields=nom,code,codeDepartement";
  if (input.postcode) {
    const cp = input.postcode.replace(/\D/g, "").slice(0, 5);
    if (cp.length !== 5) throw new SourceError("A French postcode must have 5 digits.");
    let list: Commune[] = await fetchJson(`${GEO_API}?codePostal=${cp}&${fields}`, {}, 10000);
    if (list.some((c) => CITY_WITH_ARRONDISSEMENTS.has(c.code))) {
      const arr: Commune[] = await fetchJson(`${GEO_API}?codePostal=${cp}&type=arrondissement-municipal&${fields}`, {}, 10000);
      list = [...list.filter((c) => !CITY_WITH_ARRONDISSEMENTS.has(c.code)), ...arr];
    }
    return list;
  }
  if (input.town) {
    const list: Commune[] = await fetchJson(
      `${GEO_API}?nom=${encodeURIComponent(input.town)}&${fields}&boost=population&limit=1`,
      {},
      10000,
    );
    if (list[0] && CITY_WITH_ARRONDISSEMENTS.has(list[0].code)) {
      const arr: Commune[] = await fetchJson(`${GEO_API}?nom=${encodeURIComponent(input.town)}&type=arrondissement-municipal&${fields}&limit=30`, {}, 10000);
      return arr.filter((a) => a.code.startsWith(list[0].codeDepartement));
    }
    return list.slice(0, 1);
  }
  throw new SourceError("Give a French postcode or town.");
}

let yearsCache: { at: number; years: number[] } | null = null;
async function dvfYears(): Promise<number[]> {
  if (yearsCache && Date.now() - yearsCache.at < 6 * 3600 * 1000) return yearsCache.years;
  const res = await fetch(DVF_BASE, { headers: { "user-agent": "pricepaid-plug/0.1" } });
  if (!res.ok) throw new SourceError(`DVF index returned HTTP ${res.status}`);
  const html = await res.text();
  const years = [...new Set([...html.matchAll(/(20\d{2})\//g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (!years.length) throw new SourceError("Could not read the DVF year list");
  yearsCache = { at: Date.now(), years };
  return years;
}

async function fetchCommuneCsv(year: number, c: Commune): Promise<string[][]> {
  const url = `${DVF_BASE}${year}/communes/${c.codeDepartement}/${c.code}.csv`;
  const res = await fetch(url, { headers: { "user-agent": "pricepaid-plug/0.1" }, redirect: "follow" });
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

export async function frHomeSales(input: {
  postcode?: string;
  town?: string;
  property_type?: string;
  months?: number;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").toLowerCase() as FrPropertyType;
  if (!FR_PROPERTY_TYPES.includes(type)) throw new SourceError(`property_type must be one of: ${FR_PROPERTY_TYPES.join(", ")} for France`);
  const months = Math.max(1, Math.min(24, Math.round(input.months ?? 12)));
  const communes = await resolveCommunes(input);
  if (!communes.length) throw new SourceError("No French commune found for that postcode or town.");
  if (communes.length > 25) throw new SourceError("That area covers too many communes; give a postcode instead.");
  const years = (await dvfYears()).slice(-2);
  const files = await Promise.all(years.flatMap((y) => communes.map((c) => fetchCommuneCsv(y, c))));
  const sales = files.flatMap(dvfSales).filter((s) => type === "any" || s.type === type);
  const { kept, from, to } = windowSales(sales, months);
  const s = summarise(kept.map((x) => x.price));
  const psm = summarise(kept.filter((x) => x.surface >= 9).map((x) => x.price / x.surface));
  const place = input.postcode ? `postcode ${input.postcode}` : communes.length === 1 ? communes[0].nom : input.town!;
  return buildAnswer({
    source: INFO,
    query: { country: "FR", postcode: input.postcode ?? null, town: input.town ?? null, property_type: type, months },
    summary: s,
    currency: "EUR",
    unit: "per home",
    period: { from, to },
    method:
      `Median and 10th–90th percentile of sales recorded in DVF for the commune(s), over the latest ${months} months available. ` +
      "Only plain sales ('Vente') of exactly one house or apartment are counted (with or without outbuildings or land); sales that include commercial premises or several homes are left out. DVF is published with a delay of several months.",
    describe: (x) =>
      `${TYPE_LABEL[type]} in ${place} sold for a median of ${fmtMoney(x.median, "EUR")}; typical range ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")}.`,
    baseUrl: input.baseUrl,
    extra: {
      communes: communes.map((c) => ({ code: c.code, name: c.nom })),
      ...(psm && psm.count >= 5 ? { median_price_per_sqm: psm.median } : {}),
      data_lag_note: "DVF is updated twice a year; the most recent months are not yet included.",
    },
  });
}
