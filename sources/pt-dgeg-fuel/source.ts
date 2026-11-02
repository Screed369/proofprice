// Portugal: station-level pump prices from DGEG's price search (Direção-Geral de Energia e Geologia), format checked live 2 Nov 2026.
// The service answers GET /api/PrecoComb/PesquisarPostos; every parameter must be sent, also the empty ones (a missing orderDesc= gives HTTP 500).
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import type { PriceSummary } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../../lib/fuels";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";
import { widenSentence } from "../../lib/widen";

export const INFO: SourceInfo = {
  id: "pt-dgeg-fuel",
  country: "PT",
  category: "fuel (pump prices)",
  name: "Preços dos Combustíveis Online (price of fuels at filling stations)",
  publisher: "Direção-Geral de Energia e Geologia (DGEG), Portugal",
  what_is_recorded: "Current pump price at each filling station in mainland Portugal, by fuel type, as reported by the station operator.",
  price_type: "posted_pump_price",
  freshness: "Operators must report a price change before it applies; each station carries its own last-update date",
  licence:
    "DGEG site terms: 'A informação disponível neste sítio é gratuita, podendo ser utilizada livremente.' and 'A reutilização desta informação deverá assegurar a adequada identificação da Direção-Geral de Energia e Geologia enquanto fonte dos dados, bem como a indicação da data-hora da última atualização dos preços e a reprodução fiel de toda a informação.' (https://precoscombustiveis.dgeg.gov.pt/apresentacao/, read 31 Oct 2026). No named licence and no explicit statement on commercial use, so this source is served free of charge only.",
  licence_url: "https://precoscombustiveis.dgeg.gov.pt/apresentacao/",
  attribution:
    "Fonte: Direção-Geral de Energia e Geologia (DGEG), Preços dos Combustíveis Online; data-hora da última atualização: the dates in each answer's period and extra.last_update. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://precoscombustiveis.dgeg.gov.pt/",
  limits:
    "Posted pump prices in euros per litre (CNG per kg), taxes included; not individual receipts. Mainland Portugal only (no Madeira or the Azores). Petrol 95 is the standard 'Gasolina simples 95', diesel the standard 'Gasóleo simples'; branded premium grades are not mixed in. Prices outside 0.30 to 5 EUR are treated as missing.",
};

const BASE = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos";

/** DGEG fuel-type ids (GetTiposCombustiveis, checked 2 Nov 2026). */
export const PT_FUEL_ID: Partial<Record<Fuel, number>> = {
  petrol95: 3201, // Gasolina simples 95
  petrol98: 3400, // Gasolina 98
  diesel: 2101, // Gasóleo simples
  lpg: 1120, // GPL Auto
  methane: 1143, // GNC, EUR per kg
};
export const PT_NICHE = new Set<Fuel>(["lpg", "methane"]);

/** District ids (GetDistritos, mainland). */
export const PT_DISTRICTS: Record<string, string> = {
  "01": "Aveiro", "02": "Beja", "03": "Braga", "04": "Bragança", "05": "Castelo Branco", "06": "Coimbra", "07": "Évora", "08": "Faro", "09": "Guarda",
  "10": "Leiria", "11": "Lisboa", "12": "Portalegre", "13": "Porto", "14": "Santarém", "15": "Setúbal", "16": "Viana do Castelo", "17": "Vila Real", "18": "Viseu",
};
const DISTRICT_BY_NAME = new Map(Object.entries(PT_DISTRICTS).map(([id, n]) => [stripAccents(n), id]));
const DISTRICT_ALIASES: Record<string, string> = { OPORTO: "13", LISBON: "11", CASTELOBRANCO: "05", "CASTELO BRANCO": "05" };

export function ptDistrictId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d{1,2}$/.test(t)) {
    const id = t.padStart(2, "0");
    return PT_DISTRICTS[id] ? id : null;
  }
  const k = stripAccents(t.replace(/^(distrito|district)\s+(de|of)?\s*/i, ""));
  return DISTRICT_BY_NAME.get(k) ?? DISTRICT_ALIASES[k] ?? null;
}

export interface PtStation {
  name: string;
  brand: string;
  town: string; // Município
  locality: string;
  district: string; // id
  postcode: string; // "2550-362"
  price: number;
  updated: string; // "2026-10-09 17:55"
}

export const PT_MIN_PRICE = 0.3;
export const PT_MAX_PRICE = 5;

/** "1,939 €" -> 1.939; NaN for anything else or an implausible number. */
export function parsePtPrice(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[€\s ]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n >= PT_MIN_PRICE && n <= PT_MAX_PRICE ? n : NaN;
}

export function parsePtStations(json: any): PtStation[] {
  if (!json || json.status !== true || !Array.isArray(json.resultado)) throw new SourceError("Unexpected response from the DGEG fuel price service");
  return json.resultado
    .map((r: any): PtStation => ({
      name: String(r.Nome ?? "").trim(),
      brand: String(r.Marca ?? "").trim(),
      town: String(r.Municipio ?? "").trim(),
      locality: String(r.Localidade ?? "").trim(),
      district: ptDistrictId(String(r.Distrito ?? "")) ?? "",
      postcode: String(r.CodPostal ?? "").trim(),
      price: parsePtPrice(r.Preco),
      updated: String(r.DataAtualizacao ?? "").trim(),
    }))
    .filter((s: PtStation) => Number.isFinite(s.price));
}

export function ptNationalUrl(fuel: Fuel): string {
  const id = PT_FUEL_ID[fuel];
  return `${BASE}?idsTiposComb=${id}&idMarca=&idTipoPosto=&idDistrito=&idsMunicipios=&qtdPorPagina=6000&pagina=1&orderDesc=`;
}

const cache = new Map<string, { at: number; stations: PtStation[] }>();
async function loadStations(fuel: Fuel, timeoutMs = 25000): Promise<PtStation[]> {
  const hit = cache.get(fuel);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.stations;
  const json = await fetchJson(ptNationalUrl(fuel), { headers: { accept: "application/json" } }, timeoutMs);
  const stations = parsePtStations(json);
  cache.set(fuel, { at: Date.now(), stations });
  return stations;
}

const dateOf = (u: string) => (/^\d{4}-\d{2}-\d{2}/.test(u) ? u.slice(0, 10) : null);

export async function ptFuelNow(input: { postcode?: string; area?: string; town?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  const fuel = input.fuel;
  if (!PT_FUEL_ID[fuel]) throw new InputError(`Fuel '${fuel}' is not published for Portugal. Use ${Object.keys(PT_FUEL_ID).join(", ")}.`);
  const all = await loadStations(fuel);
  const unit = fuel === "methane" ? "per kg" : "per litre";

  let picked = all;
  let place = "mainland Portugal";
  let districtId: string | null = null;
  const digits = input.postcode?.replace(/\D/g, "") ?? "";
  if (digits.length >= 4) {
    picked = all.filter((s) => s.postcode.replace(/\D/g, "").startsWith(digits.slice(0, 4)));
    place = `postcode area ${digits.slice(0, 4)}`;
  } else if (input.area || input.town) {
    districtId = ptDistrictId(input.area) ?? null;
    if (input.area && !districtId) {
      throw new InputError(
        `Portugal: area must be a district name or number (01–18), e.g. area=Lisboa or area=13. Districts: ${Object.values(PT_DISTRICTS).join(", ")}. Examples: /api/v1/fuel?country=PT&area=Porto&fuel=diesel , /api/v1/fuel?country=PT&town=Cascais&fuel=petrol95 , /api/v1/fuel?country=PT&postcode=1000&fuel=diesel.`,
      );
    }
    if (districtId) {
      picked = all.filter((s) => s.district === districtId);
      place = `${PT_DISTRICTS[districtId]} district`;
    } else if (input.town) {
      const t = stripAccents(input.town);
      const byTown = all.filter((s) => stripAccents(s.town) === t);
      const byDistrict = ptDistrictId(input.town);
      if (byTown.length) {
        picked = byTown;
        place = input.town;
      } else if (byDistrict) {
        districtId = byDistrict;
        picked = all.filter((s) => s.district === byDistrict);
        place = `${PT_DISTRICTS[byDistrict]} district`;
      } else {
        throw new InputError(
          `Portugal: no station found in '${input.town}'. Give a municipality (town=Cascais), a district (area=Porto), or a postcode (postcode=1000). Examples: /api/v1/fuel?country=PT&town=Cascais&fuel=petrol95 , /api/v1/fuel?country=PT&area=Faro&fuel=diesel , /api/v1/fuel?country=PT&fuel=diesel.`,
        );
      }
    }
  }

  let s: PriceSummary | null = summarise(picked.map((x) => x.price));
  let notice: string | undefined;
  let widenedTo: string | null = null;
  if ((!s || s.count < 5) && picked !== all) {
    // Ladder: the district of the stations found (most common), then the whole country.
    if (!districtId && picked.length) {
      const counts = new Map<string, number>();
      for (const p of picked) counts.set(p.district, (counts.get(p.district) ?? 0) + 1);
      districtId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] || null;
    }
    const inDistrict = districtId ? all.filter((x) => x.district === districtId) : [];
    const ds = summarise(inDistrict.map((x) => x.price));
    if (districtId && ds && ds.count >= 5 && place !== `${PT_DISTRICTS[districtId]} district`) {
      notice = widenSentence(FUEL_LABEL[fuel], place, `${PT_DISTRICTS[districtId]} district`, ds.count);
      widenedTo = `${PT_DISTRICTS[districtId]} district`;
      picked = inDistrict;
      s = ds;
      place = widenedTo;
    } else if (PT_NICHE.has(fuel) || !s || s.count === 0 || (s && s.count < 5)) {
      const ns = summarise(all.map((x) => x.price));
      if (ns && ns.count >= 5) {
        notice = widenSentence(FUEL_LABEL[fuel], place, "mainland Portugal", ns.count);
        widenedTo = "mainland Portugal";
        picked = all;
        s = ns;
        place = widenedTo;
      }
    }
  }

  const dates = picked.map((x) => dateOf(x.updated)).filter((d): d is string => !!d).sort();
  const lastUpdate = picked.map((x) => x.updated).filter(Boolean).sort().pop() ?? null;
  const cheapest = [...picked].sort((a, b) => a.price - b.price).slice(0, 3).map((x) => ({ name: x.name, brand: x.brand, town: x.town, postcode: x.postcode, price: x.price, updated: x.updated }));
  const a = buildAnswer({
    source: INFO,
    query: { country: "PT", postcode: input.postcode ?? null, area: input.area ?? null, town: input.town ?? null, fuel },
    summary: s,
    currency: "EUR",
    unit,
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      "Median and 10th–90th percentile of the current pump price reported by each filling station in the area for the selected fuel (standard grade). Each station's price carries its own last-update date; the period runs from the oldest to the newest of them.",
    describe: (x) =>
      `${FUEL_LABEL[fuel]} in ${place}: current posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: picked.length, last_update: lastUpdate, ...(widenedTo ? { widened: true, widened_to: widenedTo } : {}) },
  });
  return notice ? { ...a, summary: `${notice} ${a.summary}`, notice: `${notice} ${a.notice}` } : a;
}

/** One day of aggregates for the library: every district and the country, per fuel. */
export function ptDailyRecords(byFuel: Partial<Record<Fuel, PtStation[]>>): HarvestResult["rows"] {
  const records: { area: string; item: string; price: number }[] = [];
  for (const [fuel, list] of Object.entries(byFuel)) for (const s of list ?? []) if (s.district) records.push({ area: s.district, item: fuel, price: s.price });
  return aggregateDaily(records, true);
}

export async function ptHarvest(): Promise<HarvestResult> {
  const byFuel: Partial<Record<Fuel, PtStation[]>> = {};
  for (const fuel of Object.keys(PT_FUEL_ID) as Fuel[]) {
    byFuel[fuel] = parsePtStations(await fetchJson(ptNationalUrl(fuel), { headers: { accept: "application/json" } }, 90000));
  }
  return { date: new Date().toISOString().slice(0, 10), currency: "EUR", unit: "per litre (CNG per kg)", rows: ptDailyRecords(byFuel) };
}

/** Library keys for a request: the district, or the whole country. */
export function ptHistoryKey(p: { area?: string; town?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!PT_FUEL_ID[p.fuel as Fuel]) return null;
  const id = ptDistrictId(p.area) ?? (p.area ? null : ptDistrictId(p.town));
  if (p.area && !id) return null;
  return id ? { area: id, item: p.fuel, label: `${PT_DISTRICTS[id]} district` } : { area: "ALL", item: p.fuel, label: "mainland Portugal" };
}
