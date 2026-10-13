// Italy: pump prices from MIMIT's daily open-data files (format checked live on 13 Oct 2026).
// Two pipe-separated files: station list and the prices in force at 8:00. Line 1 is "Estrazione del YYYY-MM-DD".
import { InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../../lib/fuels";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";

export const INFO: SourceInfo = {
  id: "it-fuel",
  country: "IT",
  category: "fuel (pump prices)",
  name: "Carburanti – Prezzi praticati e anagrafica degli impianti",
  publisher: "Ministero delle Imprese e del Made in Italy (MIMIT), Osservaprezzi carburanti",
  what_is_recorded: "Pump prices in force at 08:00 each day at every station in Italy, by fuel and service type (self or attended).",
  price_type: "posted_pump_price",
  freshness: "Daily (prices at 08:00 of the extraction day)",
  licence: "Italian Open Data Licence v2.0 (IODL 2.0)",
  licence_url: "https://www.dati.gov.it/content/italian-open-data-license-v20",
  attribution: "Fonte: Ministero delle Imprese e del Made in Italy – Osservaprezzi carburanti (IODL 2.0).",
  homepage: "https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti",
  limits: "Posted pump prices, not individual receipts. Prices not updated in 30 days are left out.",
};


const STATIONS_URL = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv";
const PRICES_URL = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv";
const MAX_AGE_DAYS = 30;

export const IT_FUEL: Partial<Record<Fuel, string>> = {
  diesel: "Gasolio",
  petrol95: "Benzina",
  lpg: "GPL",
  methane: "Metano",
};

export interface ItStation {
  id: string;
  brand: string;
  address: string;
  town: string;
  province: string;
}

export interface ItPrice {
  id: string;
  fuel: string;
  price: number;
  self: boolean;
  reportedAt: string; // ISO
}

export function extractionDate(text: string): string | null {
  return text.slice(0, 60).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

export function parseItStations(text: string): Map<string, ItStation> {
  const out = new Map<string, ItStation>();
  for (const line of text.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const f = line.split("|");
    if (f.length < 10) continue;
    const n = f.length;
    // The last four columns are fixed (town, province, lat, lon); free-text columns may contain stray pipes.
    out.set(f[0].trim(), {
      id: f[0].trim(),
      brand: f[2]?.trim() ?? "",
      address: f.slice(5, n - 4).join(" ").replace(/\s+/g, " ").trim(),
      town: f[n - 4].trim(),
      province: f[n - 3].trim().toUpperCase(),
    });
  }
  return out;
}

function itDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

export function parseItPrices(text: string): ItPrice[] {
  const out: ItPrice[] = [];
  for (const line of text.split(/\r?\n/).slice(2)) {
    const f = line.split("|");
    if (f.length < 5) continue;
    const price = Number(f[2]);
    const reportedAt = itDateToIso(f[4]);
    if (!Number.isFinite(price) || price <= 0 || !reportedAt) continue;
    out.push({ id: f[0].trim(), fuel: f[1].trim(), price, self: f[3].trim() === "1", reportedAt });
  }
  return out;
}

let cache: { at: number; stations: Map<string, ItStation>; prices: ItPrice[]; extracted: string | null } | null = null;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1" } });
    if (!res.ok) throw new SourceError(`MIMIT returned HTTP ${res.status}`);
    return await res.text();
  } catch (e: any) {
    if (e?.name === "AbortError") throw new SourceError("MIMIT timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function loadItaly() {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache;
  const [st, pr] = await Promise.all([fetchText(STATIONS_URL), fetchText(PRICES_URL)]);
  cache = { at: Date.now(), stations: parseItStations(st), prices: parseItPrices(pr), extracted: extractionDate(pr) };
  return cache;
}

export function selectItPrices(
  prices: ItPrice[],
  stations: Map<string, ItStation>,
  opts: { fuel: Fuel; service: "self" | "served"; province?: string; town?: string; extracted: string | null },
): { station: ItStation; price: number; reportedAt: string }[] {
  const name = IT_FUEL[opts.fuel];
  if (!name) return [];
  const anyService = opts.fuel === "lpg" || opts.fuel === "methane"; // usually attended only
  const wantSelf = opts.service === "self";
  const cutoff = opts.extracted ? new Date(Date.parse(opts.extracted) - MAX_AGE_DAYS * 86400000).toISOString() : "";
  const prov = opts.province?.trim().toUpperCase();
  const town = opts.town ? stripAccents(opts.town) : null;
  const best = new Map<string, { station: ItStation; price: number; reportedAt: string }>();
  for (const p of prices) {
    if (p.fuel !== name) continue;
    if (!anyService && p.self !== wantSelf) continue;
    if (cutoff && p.reportedAt < cutoff) continue;
    const s = stations.get(p.id);
    if (!s) continue;
    if (prov && s.province !== prov) continue;
    if (town && stripAccents(s.town) !== town) continue;
    const prev = best.get(p.id);
    if (!prev || p.reportedAt > prev.reportedAt) best.set(p.id, { station: s, price: p.price, reportedAt: p.reportedAt });
  }
  return [...best.values()];
}

export async function itFuelNow(input: {
  area?: string;
  town?: string;
  fuel: Fuel;
  service?: "self" | "served";
  baseUrl?: string;
}): Promise<PriceAnswer> {
  if (!IT_FUEL[input.fuel]) throw new InputError(`Fuel '${input.fuel}' is not published for Italy. Use diesel, petrol95, lpg or methane.`);
  const province = input.area?.trim().toUpperCase();
  if (!province && !input.town) throw new InputError("Give an Italian town (comune) or a 2-letter province code as area, e.g. 'MI' or 'RM'.");
  if (province && !/^[A-Z]{2}$/.test(province)) throw new InputError("Italian area must be a 2-letter province code, e.g. 'MI' or 'RM'.");
  const service = input.service === "served" ? "served" : "self";
  const data = await loadItaly();
  const rows = selectItPrices(data.prices, data.stations, { fuel: input.fuel, service, province, town: input.town, extracted: data.extracted });
  const s = summarise(rows.map((r) => r.price));
  const dates = rows.map((r) => r.reportedAt.slice(0, 10)).sort();
  const cheapest = [...rows].sort((a, b) => a.price - b.price).slice(0, 3).map((r) => ({
    id: r.station.id, brand: r.station.brand, address: r.station.address, town: r.station.town, price: r.price, reported_at: r.reportedAt,
  }));
  const unit = input.fuel === "methane" ? "per kg" : "per litre";
  const area = input.town ? `${input.town}${province ? ` (${province})` : ""}` : `province ${province}`;
  const serviceLabel = input.fuel === "lpg" || input.fuel === "methane" ? "" : service === "self" ? " (self-service)" : " (attended service)";
  return buildAnswer({
    source: INFO,
    query: { country: "IT", area: province ?? null, town: input.town ?? null, fuel: input.fuel, service },
    summary: s,
    currency: "EUR",
    unit,
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of the pump price in force at 08:00 on the extraction day at each station in the area, for the selected fuel and service type. Prices not reported in the last ${MAX_AGE_DAYS} days are left out.`,
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]}${serviceLabel} in ${area} costs a median of ${fmtMoney(x.median, "EUR")} ${unit}; typical range ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: rows.length, extraction_date: data.extracted },
  });
}

/** Library item name: the fuel, with "/served" for attended-service prices (LPG and CNG have one price). */
export function itItem(fuel: Fuel, service: "self" | "served"): string {
  return fuel === "lpg" || fuel === "methane" || service === "self" ? fuel : `${fuel}/served`;
}

/** One day of aggregates for the price library: every province, fuel and service, plus Italy as a whole ("ALL"). */
export function itDailyRows(prices: ItPrice[], stations: Map<string, ItStation>, extracted: string | null): HarvestResult {
  const rows: { area: string; item: string; price: number }[] = [];
  for (const fuel of Object.keys(IT_FUEL) as Fuel[]) {
    const services: ("self" | "served")[] = fuel === "lpg" || fuel === "methane" ? ["self"] : ["self", "served"];
    for (const service of services) {
      for (const r of selectItPrices(prices, stations, { fuel, service, extracted })) {
        if (r.station.province) rows.push({ area: r.station.province, item: itItem(fuel, service), price: r.price });
      }
    }
  }
  return { date: extracted ?? new Date().toISOString().slice(0, 10), currency: "EUR", unit: "per litre (CNG per kg)", rows: aggregateDaily(rows) };
}

export async function itHarvest(): Promise<HarvestResult> {
  const data = await loadItaly();
  return itDailyRows(data.prices, data.stations, data.extracted);
}

export function itHistoryKey(p: { area?: string; fuel: string; service?: string }): { area: string; item: string; label: string } | null {
  if (!IT_FUEL[p.fuel as Fuel]) return null;
  const service = p.service === "served" ? "served" : "self";
  const item = itItem(p.fuel as Fuel, service);
  if (p.area) {
    const prov = p.area.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(prov) ? { area: prov, item, label: `province ${prov}` } : null;
  }
  return { area: "ALL", item, label: "Italy" };
}
