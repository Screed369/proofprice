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
      `${FUEL_LABEL[input.fuel]} in ${area}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: picked.length, ...(note ? { note } : {}) },
  });
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
    if (!/^\d{1,2}$/.test(p.area.trim())) return null;
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
