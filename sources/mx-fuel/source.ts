// Mexico: pump prices that every fuel station reports to the energy regulator (CRE), published as two open XML feeds:
// prices (place_id -> regular / premium / diesel, pesos per litre) and places (place_id -> name, permit number, longitude, latitude).
// The feeds carry no state or municipality, only coordinates, and are big (about 2.4 MB and 3.2 MB), so the daily collector
// (harvest) joins them, puts each station into its state from its coordinates (./states.ts) and stores aggregates (median,
// 10th-90th percentile, count per state and for Mexico) in the price library. Answers come from the library. No single station
// is ever returned.

import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { SourceError, InputError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Fuel, stripAccents } from "../../lib/fuels";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import { MX_STATES_RAW } from "./states";

export const MX_PRICES_URL = "https://publicacionexterna.azurewebsites.net/publicaciones/prices";
export const MX_PLACES_URL = "https://publicacionexterna.azurewebsites.net/publicaciones/places";

export const INFO: SourceInfo = {
  id: "mx-fuel",
  country: "MX (Mexico)",
  category: "fuel (pump prices)",
  name: "Precios al público de gasolinas y diésel (prices and places feeds)",
  publisher: "Comisión Reguladora de Energía (CRE), Mexico",
  what_is_recorded:
    "The pump price per litre of regular petrol, premium petrol and diesel that each fuel station in Mexico reports to the regulator, with the station's permit number and coordinates (the price feed and the places feed).",
  price_type: "posted_pump_price",
  freshness:
    "The feeds are current prices reported by the stations and carry no timestamps; our copy is taken once a day and every answer shows the day of that copy",
  licence:
    "No licence text is published with the CRE feeds themselves (publicacionexterna.azurewebsites.net). Mexico's national open-data portal datos.gob.mx publishes its datasets under the \"Libre Uso MX\" terms, which allow anyone to exploit the data commercially provided the source is cited (\"Citar la fuente de origen de donde obtuvo el conjunto de datos\"; https://datos.gob.mx/libreusomx/). " +
    "We could not open the portal's page for this dataset to confirm that it carries those terms, so reuse has not been confirmed with the publisher.",
  licence_url: "https://datos.gob.mx/libreusomx/",
  attribution:
    "Fuente: Comisión Reguladora de Energía (CRE), precios al público de gasolinas y diésel (datos abiertos, Libre Uso MX); consultado por ProofPrice. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://publicacionexterna.azurewebsites.net/publicaciones/prices",
  limits:
    "Posted pump prices reported by the stations, in Mexican pesos per litre with taxes (IVA and IEPS) included, not receipts. The feeds give coordinates but no address fields, so ProofPrice assigns each station to a state from its coordinates (Natural Earth state boundaries, simplified): a station within about a kilometre of a state border can land in the neighbouring state, and there is no city or municipality level. " +
    "Regular and premium are Mexican grades (their octane ratings use a different scale from Europe's RON), not 95 or 98 RON. A station that does not report a fuel is not counted for it. The feeds carry no timestamps, so a price is as current as the station's last report.",
};

// ---------- fuels ----------

type MxType = "regular" | "premium" | "diesel";
/** The CRE price type behind each ProofPrice fuel. */
export const MX_TYPE: Partial<Record<Fuel, MxType>> = { petrol95: "regular", petrol98: "premium", diesel: "diesel" };
const FUEL_BY_TYPE: Record<MxType, Fuel> = { regular: "petrol95", premium: "petrol98", diesel: "diesel" };
export const MX_LABEL: Partial<Record<Fuel, string>> = {
  petrol95: "Regular petrol (gasolina regular, Magna)",
  petrol98: "Premium petrol (gasolina premium)",
  diesel: "Diesel",
};
/** A pump price outside this range (pesos per litre) is an entry error, not a price. */
const MIN_PRICE = 8;
const MAX_PRICE = 50;

// ---------- states ----------

interface Shape {
  code: string;
  name: string;
  polys: number[][][]; // polygons -> rings -> [lon, lat, lon, lat, ...]
  box: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

/** Decode the compact boundary file (see ./states.ts). */
export function decodeShapes(raw: string): Shape[] {
  const src = JSON.parse(raw) as { c: string; n: string; p: number[][][] }[];
  return src.map((s) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polys = s.p.map((rings) =>
      rings.map((flat) => {
        const out: number[] = [];
        let x = 0, y = 0;
        for (let i = 0; i < flat.length; i += 2) {
          x = i === 0 ? flat[0] : x + flat[i];
          y = i === 0 ? flat[1] : y + flat[i + 1];
          const lon = x / 1000, lat = y / 1000;
          out.push(lon, lat);
          if (lon < minX) minX = lon;
          if (lon > maxX) maxX = lon;
          if (lat < minY) minY = lat;
          if (lat > maxY) maxY = lat;
        }
        return out;
      }),
    );
    return { code: s.c, name: s.n, polys, box: [minX, minY, maxX, maxY] as [number, number, number, number] };
  });
}

let shapesCache: Shape[] | null = null;
const shapes = () => (shapesCache ??= decodeShapes(MX_STATES_RAW));

/** Ray casting over every ring of a polygon (even-odd: holes count out). */
function inPolygon(lon: number, lat: number, rings: number[][]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distToRings(lon: number, lat: number, rings: number[][]): number {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2], ay = r[i - 1], bx = r[i], by = r[i + 1];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(lon - (ax + t * dx), lat - (ay + t * dy)));
    }
  }
  return best;
}

/** The state code (CMX, JAL, ...) of a point. A point just outside the simplified coastline (within about 5 km) goes to the nearest state. */
export function stateOf(lon: number, lat: number, list: Shape[] = shapes()): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  for (const s of list) {
    if (lon < s.box[0] || lon > s.box[2] || lat < s.box[1] || lat > s.box[3]) continue;
    for (const poly of s.polys) if (inPolygon(lon, lat, poly)) return s.code;
  }
  let best: string | null = null;
  let bestD = 0.05;
  for (const s of list) {
    if (lon < s.box[0] - 0.06 || lon > s.box[2] + 0.06 || lat < s.box[1] - 0.06 || lat > s.box[3] + 0.06) continue;
    for (const poly of s.polys) {
      const d = distToRings(lon, lat, poly);
      if (d < bestD) {
        bestD = d;
        best = s.code;
      }
    }
  }
  return best;
}

export const MX_STATES: Record<string, string> = Object.fromEntries(decodeShapes(MX_STATES_RAW).map((s) => [s.code, s.name]));

const mxKey = (s: string) => stripAccents(s).replace(/\s+/g, " ").trim();
const NATIONAL_NAMES = new Set(["ALL", "MEXICO", "MX", "NATIONAL", "PAIS", "NACIONAL", "REPUBLICA MEXICANA"]);
const STATE_ALIASES: Record<string, string> = {
  CDMX: "CMX", DF: "CMX", "DISTRITO FEDERAL": "CMX", "MEXICO CITY": "CMX", "CIUDAD DE MEXICO": "CMX",
  EDOMEX: "MEX", "ESTADO DE MEXICO": "MEX", "STATE OF MEXICO": "MEX",
  "COAHUILA DE ZARAGOZA": "COA", "VERACRUZ DE IGNACIO DE LA LLAVE": "VER", "MICHOACAN DE OCAMPO": "MIC",
};
const STATE_BY_NAME = new Map<string, string>(Object.entries(MX_STATES).map(([code, name]) => [mxKey(name), code]));

export interface MxPlace {
  area: string; // library key: "ALL" or a state code
  label: string;
}

/** Where a request lives in the library: Mexico, or a state by name or code. Only states exist below the country. */
export function resolveMxArea(p: { area?: string; town?: string; postcode?: string }): MxPlace {
  if (p.postcode) throw new InputError("Mexico: postcodes are not used. Give a state as area, e.g. area='Ciudad de México' or 'Jalisco'.");
  const raw = (p.area ?? p.town)?.trim();
  if (!raw) return { area: NATIONAL, label: "Mexico" };
  const k = mxKey(raw);
  if (NATIONAL_NAMES.has(k)) return { area: NATIONAL, label: "Mexico" };
  const code = MX_STATES[k] ? k : STATE_ALIASES[k] ?? STATE_BY_NAME.get(k) ?? null;
  if (!code) {
    throw new InputError(
      `Mexico is published by state, not by city. '${raw}' is not a Mexican state: give a state name or code as area, e.g. 'Jalisco' for Guadalajara or 'Ciudad de México'.`,
    );
  }
  return { area: code, label: MX_STATES[code] };
}

// ---------- the CRE feeds ----------

export interface MxPrices {
  regular?: number;
  premium?: number;
  diesel?: number;
}

/** <place place_id="11703"><gas_price type="regular">22.95</gas_price> ...</place>. The same place_id can appear in several <place> elements (one fuel each): merge. */
export function parseMxPrices(xml: string): Map<string, MxPrices> {
  const out = new Map<string, MxPrices>();
  for (const m of xml.matchAll(/<place\s+place_id="(\d+)">([\s\S]*?)<\/place>/g)) {
    const entry = out.get(m[1]) ?? {};
    for (const g of m[2].matchAll(/<gas_price\s+type="(regular|premium|diesel)">\s*([\d.]+)\s*<\/gas_price>/g)) {
      const price = Number(g[2]);
      if (price >= MIN_PRICE && price <= MAX_PRICE) entry[g[1] as MxType] = price;
    }
    if (entry.regular !== undefined || entry.premium !== undefined || entry.diesel !== undefined) out.set(m[1], entry);
  }
  return out;
}

/** <place place_id="2039"><name>..</name><cre_id>..</cre_id><location><x>-116.9214</x><y>32.47641</y></location></place>: only the coordinates are kept. */
export function parseMxPlaces(xml: string): Map<string, { lon: number; lat: number }> {
  const out = new Map<string, { lon: number; lat: number }>();
  for (const m of xml.matchAll(/<place\s+place_id="(\d+)">([\s\S]*?)<\/place>/g)) {
    const x = /<x>\s*(-?[\d.]+)\s*<\/x>/.exec(m[2]);
    const y = /<y>\s*(-?[\d.]+)\s*<\/y>/.exec(m[2]);
    if (!x || !y) continue;
    const lon = Number(x[1]);
    const lat = Number(y[1]);
    if (lon < -119 || lon > -86 || lat < 14 || lat > 33.5) continue; // not in Mexico: a coordinate entered wrongly
    out.set(m[1], { lon, lat });
  }
  return out;
}

/** Join the two feeds and put each priced station into its state. */
export function mxStations(prices: Map<string, MxPrices>, places: Map<string, { lon: number; lat: number }>, list?: Shape[]) {
  const out: { state: string; fuel: Fuel; price: number }[] = [];
  let located = 0;
  for (const [id, p] of prices) {
    const where = places.get(id);
    const state = where ? stateOf(where.lon, where.lat, list) : null;
    if (!state) continue;
    located++;
    for (const type of ["regular", "premium", "diesel"] as MxType[]) {
      const price = p[type];
      if (price !== undefined) out.push({ state, fuel: FUEL_BY_TYPE[type], price });
    }
  }
  return { records: out, located };
}

/** Mexico's calendar day (UTC-6 all year since 2022) for the collection date. */
export const mxToday = (now = new Date()) => new Date(now.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);

export function mxDailyRows(records: { state: string; fuel: Fuel; price: number }[], date: string): HarvestResult {
  const flat = records.flatMap((r) => [
    { area: NATIONAL, item: r.fuel, price: r.price },
    { area: r.state, item: r.fuel, price: r.price },
  ]);
  return {
    date,
    currency: "MXN",
    unit: "per litre",
    rows: aggregateDaily(flat, false),
    note: "CRE prices and places feeds, joined by place_id; state from the station's coordinates. Areas: ALL = Mexico, otherwise the state code (CMX = Ciudad de México). Items: petrol95 = regular, petrol98 = premium, diesel.",
  };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function fetchXml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(180000) });
  } catch (e: any) {
    throw new SourceError("Could not reach the CRE fuel price feeds", String(e?.cause?.code ?? e?.message ?? e));
  }
  if (!res.ok) throw new SourceError(`CRE feed returned HTTP ${res.status}`, url, res.status);
  return (await res.text()).replace(/^﻿/, "");
}

/** Daily collector: both feeds, joined and aggregated. Refuses a feed that looks truncated. */
export async function mxHarvest(now = new Date()): Promise<HarvestResult> {
  const [pricesXml, placesXml] = await Promise.all([fetchXml(MX_PRICES_URL), fetchXml(MX_PLACES_URL)]);
  const prices = parseMxPrices(pricesXml);
  const { records, located } = mxStations(prices, parseMxPlaces(placesXml));
  if (located < 5000) throw new SourceError(`The CRE feeds gave only ${located} priced stations with a location (prices ${prices.size}); expected over 5,000`);
  return mxDailyRows(records, mxToday(now));
}

// ---------- answers ----------

export function mxHistoryKey(p: { area?: string; town?: string; postcode?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!MX_TYPE[p.fuel as Fuel]) return null;
  try {
    const place = resolveMxArea(p);
    return { area: place.area, item: p.fuel, label: `${place.label}, Mexico` };
  } catch {
    return null;
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function mxAnswerFromRow(
  row: DailyRow & { date: string },
  q: { fuel: Fuel; place: MxPlace; query: Record<string, unknown>; now?: string; baseUrl?: string },
): PriceAnswer {
  const now = q.now ?? mxToday();
  const age = Math.max(0, daysBetween(row.date, now));
  const old = age > 3;
  return buildAnswer({
    source: INFO,
    query: q.query,
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "MXN",
    unit: "per litre",
    period: { from: row.date, to: row.date },
    method:
      "Median and 10th–90th percentile of the pump prices the stations in the place reported to the regulator, taken from its public feeds on the day shown. " +
      "ProofPrice puts each station into its state from its coordinates, so a station right on a border can fall in the neighbouring state.",
    describe: (x) =>
      `${MX_LABEL[q.fuel]} in ${q.place.label}: median ${fmtMoney(x.median, "MXN")} per litre on ${row.date}; typical range (10th–90th percentile) ${fmtMoney(x.low, "MXN")}–${fmtMoney(x.high, "MXN")} across stations (posted pump prices, taxes included).` +
      (old ? ` This is old data: our copy of the regulator's feeds is ${age} days old.` : ""),
    baseUrl: q.baseUrl,
    extra: {
      coverage: "state_level",
      stations_counted: row.n,
      data_age_days: age,
      ...(old ? { stale_warning: `Our newest copy of the CRE feeds for this place is ${age} days old.` } : {}),
    },
  });
}

export async function mxFuelNow(input: { area?: string; town?: string; postcode?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  if (!MX_TYPE[input.fuel]) throw new InputError("Fuel must be petrol95 (regular petrol), petrol98 (premium petrol) or diesel for Mexico.");
  const place = resolveMxArea(input);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects the CRE fuel price feeds daily; figures appear after the first collection.");
  const rows = readDaily(INFO.id, { area: place.area, item: input.fuel, from: addDays(meta.last_date, -14), to: meta.last_date }).filter((r) => r.n >= MIN_PUBLISH);
  const row = rows[rows.length - 1];
  const query = { country: "MX", area: input.area ?? input.town ?? null, fuel: input.fuel };
  if (!row) {
    return buildAnswer({
      source: INFO,
      query,
      summary: null,
      currency: "MXN",
      unit: "per litre",
      period: { from: null, to: null },
      method: "Pump prices reported by the stations to the regulator; a state is published when at least 5 stations report the fuel.",
      describe: () => "",
      baseUrl: input.baseUrl,
      extra: { note: `Fewer than ${MIN_PUBLISH} stations in ${place.label} report ${input.fuel === "diesel" ? "diesel" : "this fuel"} in our latest copy.` },
    });
  }
  return mxAnswerFromRow(row, { fuel: input.fuel, place, query, baseUrl: input.baseUrl });
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
