// Spain: live pump prices from the Ministry's open REST service (format checked live on 13 Oct 2026).
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../../lib/fuels";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";

export const INFO: SourceInfo = {
  id: "es-fuel",
  country: "ES",
  category: "fuel (pump prices)",
  name: "Precios de carburantes en las estaciones de servicio terrestres",
  publisher: "Ministerio para la Transición Ecológica y el Reto Demográfico (Geoportal de hidrocarburos), via datos.gob.es",
  what_is_recorded: "Current pump price at each public filling station in Spain, by fuel type.",
  price_type: "posted_pump_price",
  freshness: "Several times a day",
  licence:
    "Reuse allowed, including commercial, under Spain's public-sector information reuse law (Ley 37/2007 as amended by Ley 18/2015; datos.gob.es aviso legal: reuse 'para fines comerciales y no comerciales'). The ministry's conditions: 'Que el contenido de la información, incluyendo sus metadatos, no sea alterado. Que no se desnaturalice el sentido de la información. Que se cite la fuente. Que se mencione la fecha de la última actualización.' (https://sede.serviciosmin.gob.es/es-ES/Paginas/aviso.aspx). It also reserves measures against abusive or robotised use.",
  licence_url: "https://sede.serviciosmin.gob.es/es-ES/Paginas/aviso.aspx",
  attribution:
    "Fuente: Ministerio para la Transición Ecológica y el Reto Demográfico, Precio de carburantes en las gasolineras españolas (Geoportal Gasolineras / datos.gob.es); fecha de última actualización: the date in each answer's period (the feed's Fecha). Medians and ranges are calculated by ProofPrice.",
  homepage: "https://geoportalgasolineras.es/",
  limits: "Posted pump prices in euros per litre (CNG per kg), taxes included; not individual receipts. Restricted-sale stations are excluded. Prices of 0 and implausible entries (under 0.30 or over 5 EUR) are treated as missing.",
};


const NATIONAL_URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";
const BASE = NATIONAL_URL + "FiltroProvincia/";

export const ES_FIELD: Partial<Record<Fuel, string>> = {
  diesel: "Precio Gasoleo A",
  petrol95: "Precio Gasolina 95 E5",
  petrol98: "Precio Gasolina 98 E5",
  e10: "Precio Gasolina 95 E10",
  e85: "Precio Gasolina 95 E85",
  lpg: "Precio Gases licuados del petróleo",
  methane: "Precio Gas Natural Comprimido",
};

export interface EsStation {
  id: string;
  brand: string;
  address: string;
  town: string;
  postcode: string;
  province: string | null;
  price: number;
}

export function esProvinceFromPostcode(cp: string): string | null {
  const d = cp.replace(/\D/g, "");
  if (d.length !== 5) return null;
  const p = d.slice(0, 2);
  const n = Number(p);
  return n >= 1 && n <= 52 ? p : null;
}

/** Plausible pump price bounds in EUR per litre (CNG per kg). */
export const ES_MIN_PRICE = 0.3;
export const ES_MAX_PRICE = 5;

export function parseEsPrice(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  // 0 and out-of-range entries are placeholders or typing slips, never a pump price: treat them as missing.
  return Number.isFinite(n) && n >= ES_MIN_PRICE && n <= ES_MAX_PRICE ? n : NaN;
}

function provinceOf(r: any): string | null {
  const id = String(r.IDProvincia ?? "").replace(/\D/g, "");
  if (id && Number(id) >= 1 && Number(id) <= 52) return id.padStart(2, "0");
  return esProvinceFromPostcode(String(r["C.P."] ?? ""));
}

export function parseEsStations(json: any, fuel: Fuel): { stations: EsStation[]; fecha: string | null } {
  const list = json?.ListaEESSPrecio;
  if (!Array.isArray(list)) throw new SourceError("Unexpected response from the Spanish fuel price service");
  const field = ES_FIELD[fuel];
  if (!field) throw new InputError(`Fuel '${fuel}' is not published for Spain.`);
  const stations = list
    // "P" = open to the public; "R" = restricted (e.g. members only), so left out.
    .filter((r: any) => String(r["Tipo Venta"] ?? "P").toUpperCase() === "P")
    .map((r: any) => ({
      id: String(r.IDEESS ?? ""),
      brand: String(r["Rótulo"] ?? ""),
      address: String(r["Dirección"] ?? ""),
      town: String(r.Municipio ?? r.Localidad ?? ""),
      postcode: String(r["C.P."] ?? ""),
      province: provinceOf(r),
      price: parseEsPrice(r[field]),
    }))
    .filter((s: EsStation) => Number.isFinite(s.price));
  return { stations, fecha: json?.Fecha ? String(json.Fecha) : null };
}

function fechaToIso(f: string | null): string | null {
  const m = f?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function esFuelNow(input: {
  postcode?: string;
  area?: string;
  town?: string;
  fuel: Fuel;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  if (!ES_FIELD[input.fuel]) throw new InputError(`Fuel '${input.fuel}' is not published for Spain.`);
  const cp = input.postcode?.replace(/\D/g, "");
  let province = cp ? esProvinceFromPostcode(cp) : null;
  if (!province && input.area) {
    const a = input.area.replace(/\D/g, "").padStart(2, "0");
    if (Number(a) >= 1 && Number(a) <= 52) province = a;
  }
  if (!province) throw new InputError("Give a 5-digit Spanish postcode, or a province code (01–52) as area.");

  const json = await fetchJson(BASE + province, { headers: { accept: "application/json" } }, 20000);
  const { stations: all, fecha } = parseEsStations(json, input.fuel);

  let picked = all;
  let area = `province ${province}`;
  let note: string | undefined;
  if (cp) {
    picked = all.filter((s) => s.postcode === cp);
    area = `postcode ${cp}`;
    if (picked.length < 5) {
      note = `Fewer than 5 stations sell this fuel in postcode ${cp}; widened to the whole province (${province}).`;
      picked = all;
      area = `province ${province} (around postcode ${cp})`;
    }
  } else if (input.town) {
    const t = stripAccents(input.town);
    picked = all.filter((s) => stripAccents(s.town) === t);
    area = input.town;
  }

  const s = summarise(picked.map((x) => x.price));
  const day = fechaToIso(fecha);
  const cheapest = [...picked].sort((a, b) => a.price - b.price).slice(0, 3).map(({ province, ...s }) => s);
  const unit = input.fuel === "methane" ? "per kg" : "per litre";
  return buildAnswer({
    source: INFO,
    query: { country: "ES", postcode: input.postcode ?? null, area: input.area ?? null, town: input.town ?? null, fuel: input.fuel },
    summary: s,
    currency: "EUR",
    unit,
    period: { from: day, to: day },
    method:
      "Median and 10th–90th percentile of the current pump price reported by each public filling station in the area for the selected fuel. Restricted-sale stations are excluded.",
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]} in ${area}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: picked.length, ...(note ? { note } : {}) },
  });
}

const ES_OUTSIDE_NATIONAL = new Set(["35", "38", "51", "52"]);

/** One day of aggregates for the price library: every province and fuel, plus Spain as a whole ("ALL"). */
export function esDailyRows(json: any): HarvestResult {
  const records: { area: string; item: string; price: number }[] = [];
  let fecha: string | null = null;
  for (const fuel of Object.keys(ES_FIELD) as Fuel[]) {
    const parsed = parseEsStations(json, fuel);
    fecha = parsed.fecha;
    for (const s of parsed.stations) {
      if (!s.province) continue;
      records.push({ area: s.province, item: fuel, price: s.price });
      // National row: mainland Spain and the Balearics (Canarias, Ceuta and Melilla have different fuel taxes).
      if (!ES_OUTSIDE_NATIONAL.has(s.province)) records.push({ area: "ALL", item: fuel, price: s.price });
    }
  }
  const date = fechaToIso(fecha) ?? new Date().toISOString().slice(0, 10);
  return { date, currency: "EUR", unit: "per litre (CNG per kg)", rows: aggregateDaily(records, false) };
}

export async function esHarvest(): Promise<HarvestResult> {
  const json = await fetchJson(NATIONAL_URL, { headers: { accept: "application/json" } }, 180000);
  return esDailyRows(json);
}

/** Library keys for a request: province from the postcode or area, or the whole country. */
export function esHistoryKey(p: { postcode?: string; area?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!ES_FIELD[p.fuel as Fuel]) return null;
  if (p.postcode) {
    const province = esProvinceFromPostcode(p.postcode);
    return province ? { area: province, item: p.fuel, label: `province ${province}` } : null;
  }
  if (p.area) {
    if (!/^\d{1,2}$/.test(p.area.trim())) return null;
    const a = p.area.trim().padStart(2, "0");
    return Number(a) >= 1 && Number(a) <= 52 ? { area: a, item: p.fuel, label: `province ${a}` } : null;
  }
  return { area: "ALL", item: p.fuel, label: "mainland Spain and the Balearics" };
}
