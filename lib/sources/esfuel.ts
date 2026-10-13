// Spain: live pump prices from the Ministry's open REST service (format checked live on 13 Oct 2026).
import { fetchJson, SourceError } from "../http";
import { summarise } from "../stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../fuels";

const BASE =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/";

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
  price: number;
}

export function esProvinceFromPostcode(cp: string): string | null {
  const d = cp.replace(/\D/g, "");
  if (d.length !== 5) return null;
  const p = d.slice(0, 2);
  const n = Number(p);
  return n >= 1 && n <= 52 ? p : null;
}

export function parseEsPrice(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

export function parseEsStations(json: any, fuel: Fuel): { stations: EsStation[]; fecha: string | null } {
  const list = json?.ListaEESSPrecio;
  if (!Array.isArray(list)) throw new SourceError("Unexpected response from the Spanish fuel price service");
  const field = ES_FIELD[fuel];
  if (!field) throw new SourceError(`Fuel '${fuel}' is not published for Spain.`);
  const stations = list
    // "P" = open to the public; "R" = restricted (e.g. members only), so left out.
    .filter((r: any) => String(r["Tipo Venta"] ?? "P").toUpperCase() === "P")
    .map((r: any) => ({
      id: String(r.IDEESS ?? ""),
      brand: String(r["Rótulo"] ?? ""),
      address: String(r["Dirección"] ?? ""),
      town: String(r.Municipio ?? r.Localidad ?? ""),
      postcode: String(r["C.P."] ?? ""),
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
  if (!ES_FIELD[input.fuel]) throw new SourceError(`Fuel '${input.fuel}' is not published for Spain.`);
  const cp = input.postcode?.replace(/\D/g, "");
  let province = cp ? esProvinceFromPostcode(cp) : null;
  if (!province && input.area) {
    const a = input.area.replace(/\D/g, "").padStart(2, "0");
    if (Number(a) >= 1 && Number(a) <= 52) province = a;
  }
  if (!province) throw new SourceError("Give a 5-digit Spanish postcode, or a province code (01–52) as area.");

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
  const cheapest = [...picked].sort((a, b) => a.price - b.price).slice(0, 3);
  const unit = input.fuel === "methane" ? "per kg" : "per litre";
  return buildAnswer({
    sourceId: "es-fuel",
    query: { country: "ES", postcode: input.postcode ?? null, area: input.area ?? null, town: input.town ?? null, fuel: input.fuel },
    summary: s,
    currency: "EUR",
    unit,
    period: { from: day, to: day },
    method:
      "Median and 10th–90th percentile of the current pump price reported by each public filling station in the area for the selected fuel. Restricted-sale stations are excluded.",
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]} in ${area} costs a median of ${fmtMoney(x.median, "EUR")} ${unit} right now; typical range ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: picked.length, ...(note ? { note } : {}) },
  });
}
