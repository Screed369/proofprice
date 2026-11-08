// Spain: live pump prices from the Ministry's open REST service (format checked live on 13 Oct 2026).
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../../lib/fuels";
import type { BackfillResult, HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";
import { nationalRow, widenSentence } from "../../lib/widen";

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
const MUNICIPIOS_URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/Listados/Municipios/";

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


/** Province names (and common Spanish, English, Catalan, Basque and Galician spellings) -> INE province code, so area=Madrid or
 *  town=Valencia work as well as area=28. Keys are compared with accents and case stripped. */
const ES_PROVINCE_NAMES: Record<string, string[]> = {
  "01": ["Álava", "Araba", "Araba/Álava", "Alava"], "02": ["Albacete"], "03": ["Alicante", "Alacant", "Alicante/Alacant"], "04": ["Almería"],
  "05": ["Ávila"], "06": ["Badajoz"], "07": ["Balearic Islands", "Illes Balears", "Islas Baleares", "Baleares", "Balears", "Mallorca", "Majorca", "Palma", "Palma de Mallorca", "Menorca", "Ibiza", "Eivissa"],
  "08": ["Barcelona"], "09": ["Burgos"], "10": ["Cáceres"], "11": ["Cádiz", "Cadiz"], "12": ["Castellón", "Castelló", "Castellón/Castelló", "Castellon de la Plana"],
  "13": ["Ciudad Real"], "14": ["Córdoba", "Cordoba"], "15": ["A Coruña", "La Coruña", "Coruña", "Corunna"], "16": ["Cuenca"], "17": ["Girona", "Gerona"],
  "18": ["Granada"], "19": ["Guadalajara"], "20": ["Gipuzkoa", "Guipúzcoa", "Guipuzcoa", "San Sebastián", "Donostia", "Donostia-San Sebastián"], "21": ["Huelva"], "22": ["Huesca"],
  "23": ["Jaén", "Jaen"], "24": ["León", "Leon"], "25": ["Lleida", "Lérida", "Lerida"], "26": ["La Rioja", "Rioja", "Logroño", "Logrono"], "27": ["Lugo"], "28": ["Madrid"],
  "29": ["Málaga", "Malaga"], "30": ["Murcia"], "31": ["Navarre", "Navarra", "Pamplona", "Iruña"], "32": ["Ourense", "Orense"], "33": ["Asturias", "Oviedo"],
  "34": ["Palencia"], "35": ["Las Palmas", "Las Palmas de Gran Canaria", "Gran Canaria"], "36": ["Pontevedra", "Vigo"], "37": ["Salamanca"],
  "38": ["Santa Cruz de Tenerife", "Tenerife"], "39": ["Cantabria", "Santander"], "40": ["Segovia"], "41": ["Seville", "Sevilla"], "42": ["Soria"],
  "43": ["Tarragona"], "44": ["Teruel"], "45": ["Toledo"], "46": ["Valencia", "València"], "47": ["Valladolid"], "48": ["Bizkaia", "Vizcaya", "Biscay", "Bilbao"],
  "49": ["Zamora"], "50": ["Zaragoza", "Saragossa"], "51": ["Ceuta"], "52": ["Melilla"],
};
const ES_NAME_TO_PROVINCE = new Map<string, string>(
  Object.entries(ES_PROVINCE_NAMES).flatMap(([code, names]) => names.map((n) => [stripAccents(n), code] as [string, string])),
);

/** "Madrid", "provincia de Sevilla", "Province of Girona" -> "28" | "41" | "17"; null when the text is not a province name. */
export function esProvinceFromName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = stripAccents(raw.replace(/\b(provincia|province|prov\.?)\s+(de|del|of)?\s*/i, "").replace(/\s*\b(province|provincia)$/i, ""));
  return ES_NAME_TO_PROVINCE.get(t) ?? null;
}

let muniIndex: { at: number; map: Map<string, string | null> } | null = null;
/** Parse the ministry's municipality list (about 1 MB, 8,000 rows) into name -> province code; a name used in two provinces maps to null. */
export function parseEsMunicipios(json: unknown): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!Array.isArray(json)) return map;
  for (const r of json as any[]) {
    const prov = String(r?.IDProvincia ?? "").padStart(2, "0");
    if (!r?.Municipio || !/^\d{2}$/.test(prov)) continue;
    const name = stripAccents(String(r.Municipio));
    const seen = map.get(name);
    map.set(name, seen === undefined || seen === prov ? prov : null);
  }
  return map;
}
/** Fast town -> province: the small municipality list (about 2 s) instead of the 10 MB national feed (about 20 s cold). Null when the
 *  name is unknown, ambiguous or the list is unreachable; the caller then falls back to the national feed. */
async function esProvinceOfMunicipio(town: string): Promise<string | null> {
  try {
    if (!muniIndex || Date.now() - muniIndex.at > 24 * 3600 * 1000) {
      const map = parseEsMunicipios(await fetchJson(MUNICIPIOS_URL, { headers: { accept: "application/json" } }, 8000));
      if (map.size < 100) return null; // not the real list (error page, partial answer): never cached
      muniIndex = { at: Date.now(), map };
    }
    return muniIndex.map.get(stripAccents(town)) ?? null;
  } catch {
    return null;
  }
}

let townIndex: { at: number; map: Map<string, string> } | null = null;
/** Municipality name -> province code (the province with most stations of that name), read from the national feed; cached for 6 hours. */
async function esProvinceOfTown(town: string): Promise<string | null> {
  const t = stripAccents(town);
  if (!townIndex || Date.now() - townIndex.at > 6 * 3600 * 1000) {
    const json = await fetchJson(NATIONAL_URL, { headers: { accept: "application/json" } }, 40000);
    const list = json?.ListaEESSPrecio;
    if (!Array.isArray(list)) throw new SourceError("Unexpected response from the Spanish fuel price service");
    const counts = new Map<string, Map<string, number>>();
    for (const r of list) {
      const prov = provinceOf(r);
      if (!prov) continue;
      for (const name of new Set([r.Municipio, r.Localidad].filter(Boolean).map((x: any) => stripAccents(String(x))))) {
        const m = counts.get(name) ?? new Map<string, number>();
        m.set(prov, (m.get(prov) ?? 0) + 1);
        counts.set(name, m);
      }
    }
    const map = new Map<string, string>();
    for (const [name, m] of counts) map.set(name, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    townIndex = { at: Date.now(), map };
  }
  return townIndex.map.get(t) ?? null;
}

export async function esFuelNow(input: {
  postcode?: string;
  area?: string;
  town?: string;
  fuel: Fuel;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  if (!ES_FIELD[input.fuel]) throw new InputError(`Fuel '${input.fuel}' is not published for Spain.`);
  let cp = input.postcode?.replace(/\D/g, "");
  // A province code (08, 30) sent as the postcode is a province, not a postcode: answer for the province.
  if (cp && cp.length <= 2) {
    input = { ...input, area: cp, postcode: undefined };
    cp = undefined;
  }
  let province = cp ? esProvinceFromPostcode(cp) : null;
  if (!province && input.area) {
    const digits = input.area.replace(/\D/g, "");
    const a = digits.padStart(2, "0");
    if (digits && Number(a) >= 1 && Number(a) <= 52) province = a;
    else province = esProvinceFromName(input.area);
  }
  // A place name with no code: a province name (town=Madrid) or any municipality found in the national feed (town=Marbella).
  if (!province && input.town) {
    province = esProvinceFromName(input.town) ?? (await esProvinceOfMunicipio(input.town)) ?? (await esProvinceOfTown(input.town));
  }
  // Country-only question (no postcode, area or town): answer with the labelled national figure instead of a 400.
  if (!province && !input.postcode && !input.area && !input.town) {
    const national = await esNationalNow(input.fuel, input.baseUrl);
    if (national) return national;
  }
  if (!province) {
    throw new InputError(
      `Spain: give a 5-digit postcode, a province code (01–52) or name as area (area=Madrid, area=28), or a town name (town=Marbella). Examples: /api/v1/fuel?country=ES&area=Madrid&fuel=diesel , /api/v1/fuel?country=ES&postcode=28001&fuel=petrol95 , /api/v1/fuel?country=ES&town=Valencia&fuel=diesel.`,
    );
  }

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

  let s = summarise(picked.map((x) => x.price));
  let townWidened = false;
  const day = fechaToIso(fecha);
  // A town with fewer than 5 stations for a common fuel: say so and answer for its province instead of refusing.
  if ((!s || s.count < 5) && !cp && input.town && !ES_NICHE.has(input.fuel)) {
    const prov = summarise(all.map((x) => x.price));
    if (prov && prov.count >= 5) {
      note = `Fewer than 5 stations sell ${FUEL_LABEL[input.fuel]} in ${input.town}, so no local range is published; this is the figure for province ${province} instead.`;
      townWidened = true;
      picked = all;
      area = `province ${province} (around ${input.town})`;
      s = prov;
    }
  }
  // Niche fuels (LPG, methane) are sold at few stations: a thin province gets the labelled national figure, never a bare refusal.
  if ((!s || s.count < 5) && ES_NICHE.has(input.fuel)) {
    // A thin town: its whole province when that has 5 or more stations; otherwise (and for a thin province) the national figure.
    if (input.town && !cp) {
      const prov = summarise(all.map((x) => x.price));
      if (prov && prov.count >= 5) {
        const sentence = `Fewer than 5 stations sell ${FUEL_LABEL[input.fuel]} in ${input.town}, so no local range is published; this is the figure for province ${province} instead.`;
        const a = await esFuelNow({ area: province, fuel: input.fuel, baseUrl: input.baseUrl });
        return { ...a, summary: `${sentence} ${a.summary}`, notice: `${sentence} ${a.notice}`, extra: { ...a.extra, widened: true, widened_from: input.town, widened_to: `province ${province}` } };
      }
    }
    // The province's autonomous community first (finer), then the national figure.
    const place = cp ? `postcode ${cp}` : input.town ?? `province ${province}`;
    const regionCode = esRegionOf(province);
    const wide =
      (regionCode ? esWidenToNational(input.fuel, place, input.baseUrl, undefined, regionCode) : null) ??
      esWidenToNational(input.fuel, place, input.baseUrl);
    if (wide) return wide;
  }
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
      `${townWidened && note ? note + " " : ""}${FUEL_LABEL[input.fuel]} in ${area}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: picked.length, ...(note ? { note } : {}) },
  });
}

/** Spain as a whole (mainland and the Balearics) for a country-only question: our daily copy first, else the live national feed. */
export async function esNationalNow(fuel: Fuel, baseUrl?: string): Promise<PriceAnswer | null> {
  const unit = fuel === "methane" ? "per kg" : "per litre";
  const whole = "mainland Spain and the Balearics";
  let summary: ReturnType<typeof summarise> = null;
  let day: string | null = null;
  let source = "live national feed";
  // A copy from today or yesterday is as good as the live feed (the ministry updates it through the day) and answers in milliseconds;
  // the live feed (about 20 s cold) is only for a missing or older copy.
  const fresh = nationalRow("es-fuel", fuel);
  const freshDay = fresh && Date.now() - Date.parse(fresh.date + "T00:00:00Z") <= 2 * 86400000 ? fresh : null;
  if (freshDay) {
    summary = freshDay.summary;
    day = freshDay.date;
    source = `our daily copy of ${freshDay.date}`;
  }
  if (!summary) try {
    const json = await fetchJson(NATIONAL_URL, { headers: { accept: "application/json" } }, 25000);
    const parsed = parseEsStations(json, fuel);
    summary = summarise(parsed.stations.filter((x) => !ES_OUTSIDE_NATIONAL.has(x.province ?? "")).map((x) => x.price));
    day = fechaToIso(parsed.fecha);
  } catch {
    summary = null;
  }
  if (!summary || summary.count < 5 || !day) {
    const row = nationalRow("es-fuel", fuel);
    if (!row) return null;
    summary = row.summary;
    day = row.date;
    source = `our daily copy of ${row.date}`;
  }
  const note = `No area was given, so this is the national figure for ${whole} (${summary.count} stations). Give a postcode, province (area=Madrid) or town for a local range.`;
  const a = buildAnswer({
    source: INFO,
    query: { country: "ES", postcode: null, area: null, town: null, fuel },
    summary,
    currency: "EUR",
    unit,
    period: { from: day, to: day },
    method: `Median and 10th–90th percentile of the current pump price reported by each public filling station in ${whole} for the selected fuel (${source}). Restricted-sale stations are excluded.`,
    describe: (x) =>
      `${FUEL_LABEL[fuel]} in ${whole}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl,
    extra: { national: true, widened_to: whole, stations_counted: summary.count },
  });
  return { ...a, summary: `${note} ${a.summary}`, notice: `${note} ${a.notice}` };
}

const ES_NICHE = new Set<Fuel>(["lpg", "methane"]);

/** The national (mainland + Balearics) library row for this fuel as a labelled answer; null when the library has none. */
export function esWidenToNational(fuel: Fuel, area: string, baseUrl?: string, today?: Date, region?: string): PriceAnswer | null {
  const whole = region ? ES_REGIONS[region]?.name : "mainland Spain and the Balearics";
  if (!whole) return null;
  const row = nationalRow("es-fuel", fuel, today, region ?? "ALL");
  if (!row) return null;
  const unit = fuel === "methane" ? "per kg" : "per litre";
  const sentence = widenSentence(FUEL_LABEL[fuel], area, whole, row.summary.count);
  const a = buildAnswer({
    source: INFO,
    query: { country: "ES", postcode: null, area: area.replace(/\D/g, "") || null, town: null, fuel },
    summary: row.summary,
    currency: "EUR",
    unit,
    period: { from: row.date, to: row.date },
    method:
      `Median and 10th–90th percentile of the current pump price reported by each public filling station in ${whole} for the selected fuel (our daily copy of ${row.date}). Restricted-sale stations are excluded.`,
    describe: (x) =>
      `${FUEL_LABEL[fuel]} in ${whole}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl,
    extra: { widened: true, widened_from: area, widened_to: whole, stations_counted: row.summary.count },
  });
  return { ...a, summary: `${sentence} ${a.summary}`, notice: `${sentence} ${a.notice}` };
}

/** Autonomous communities and their province codes. The library also holds one row per community ("RAN" ...), used only to
 *  widen a thin province for LPG/methane to its community before the national figure. Ceuta and Melilla (51, 52) have none. */
export const ES_REGIONS: Record<string, { name: string; provinces: string[] }> = {
  RAN: { name: "Andalusia", provinces: ["04", "11", "14", "18", "21", "23", "29", "41"] },
  RAR: { name: "Aragon", provinces: ["22", "44", "50"] },
  RAS: { name: "Asturias", provinces: ["33"] },
  RBA: { name: "the Balearic Islands", provinces: ["07"] },
  RCN: { name: "the Canary Islands", provinces: ["35", "38"] },
  RCB: { name: "Cantabria", provinces: ["39"] },
  RCL: { name: "Castile and León", provinces: ["05", "09", "24", "34", "37", "40", "42", "47", "49"] },
  RCM: { name: "Castilla-La Mancha", provinces: ["02", "13", "16", "19", "45"] },
  RCT: { name: "Catalonia", provinces: ["08", "17", "25", "43"] },
  RVC: { name: "the Valencian Community", provinces: ["03", "12", "46"] },
  REX: { name: "Extremadura", provinces: ["06", "10"] },
  RGA: { name: "Galicia", provinces: ["15", "27", "32", "36"] },
  RMD: { name: "the Community of Madrid", provinces: ["28"] },
  RMC: { name: "the Region of Murcia", provinces: ["30"] },
  RNC: { name: "Navarre", provinces: ["31"] },
  RPV: { name: "the Basque Country", provinces: ["01", "20", "48"] },
  RRI: { name: "La Rioja", provinces: ["26"] },
};
const REGION_OF = new Map<string, string>(Object.entries(ES_REGIONS).flatMap(([r, v]) => v.provinces.map((p) => [p, r] as [string, string])));
export const esRegionOf = (province: string): string | null => REGION_OF.get(province) ?? null;

const ES_OUTSIDE_NATIONAL = new Set(["35", "38", "51", "52"]);

/** One day of aggregates for the price library: every province and fuel, plus each autonomous community and Spain as a whole ("ALL"). */
export function esDailyRows(json: any): HarvestResult {
  const records: { area: string; item: string; price: number }[] = [];
  let fecha: string | null = null;
  for (const fuel of Object.keys(ES_FIELD) as Fuel[]) {
    const parsed = parseEsStations(json, fuel);
    fecha = parsed.fecha;
    for (const s of parsed.stations) {
      if (!s.province) continue;
      records.push({ area: s.province, item: fuel, price: s.price });
      const region = esRegionOf(s.province);
      if (region) records.push({ area: region, item: fuel, price: s.price });
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
    if (!/^\d{1,2}$/.test(p.area.trim())) {
      const named = esProvinceFromName(p.area);
      return named ? { area: named, item: p.fuel, label: `province ${named}` } : null;
    }
    const a = p.area.trim().padStart(2, "0");
    return Number(a) >= 1 && Number(a) <= 52 ? { area: a, item: p.fuel, label: `province ${a}` } : null;
  }
  return { area: "ALL", item: p.fuel, label: "mainland Spain and the Balearics" };
}


const HIST_URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestresHist/";
const ES_UA = "ProofPrice-Historian/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** The Ministry's past-date service takes dd-mm-yyyy. */
export function esHistUrl(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${HIST_URL}${d}-${m}-${y}`;
}

/** Months "YYYY-MM" from `from` to `to` inclusive. */
export function esMonthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** One month of aggregates from a snapshot of all stations; null when the snapshot is empty. */
export function esMonthRows(json: any): BackfillResult["periods"][number]["rows"] | null {
  if (!Array.isArray(json?.ListaEESSPrecio) || json.ListaEESSPrecio.length === 0) return null;
  const rows = esDailyRows(json).rows;
  return rows.length ? rows : null;
}

async function fetchHist(day: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(esHistUrl(day), { headers: { accept: "application/json", "user-agent": ES_UA }, signal: AbortSignal.timeout(120000) });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text.trim() ? JSON.parse(text) : null;
    } catch (e) {
      if (attempt === 3) {
        console.log(`Spain ${day}: skipped (${String((e as Error).message)})`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  return null;
}

/** Monthly history: the posted prices of every public station on the 15th of each month. Two requests at a time, a pause between. */
export async function esBackfill(from: string, to: string): Promise<BackfillResult> {
  const months = esMonthsBetween(from.slice(0, 7), to.slice(0, 7));
  const byMonth = new Map<string, BackfillResult["periods"][number]["rows"]>();
  let next = 0;
  const worker = async (w: number) => {
    await new Promise((r) => setTimeout(r, w * 1500));
    while (next < months.length) {
      const month = months[next++];
      const t0 = Date.now();
      const json = await fetchHist(`${month}-15`);
      const rows = json ? esMonthRows(json) : null;
      if (rows) byMonth.set(month, rows);
      console.log(`${month}: ${rows ? rows.length + " rows" : "no data"} (${Math.round((Date.now() - t0) / 1000)}s)`);
      await new Promise((r) => setTimeout(r, 2000)); // be gentle with the publisher
    }
  };
  await Promise.all([worker(0), worker(1)]);
  const periods: BackfillResult["periods"] = months.filter((m) => byMonth.has(m)).map((m) => ({ period: m, rows: byMonth.get(m)! }));
  return {
    currency: "EUR",
    unit: "per litre (CNG per kg)",
    periods,
    note: "Monthly figures from the Ministry's past-date price service: the posted pump price of every public station on the 15th of the month, then the median and 10th-90th percentile across stations (posted prices, not receipts). Spain as a whole (ALL) is mainland Spain and the Balearics.",
  };
}
