// France live pump prices from the Ministère de l'Économie open feed (updated ~every 10 minutes).
// Station addresses are business addresses and are returned for the cheapest stations.

import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";
import type { Fuel } from "../../lib/fuels";

export const INFO: SourceInfo = {
  id: "fr-fuel",
  country: "FR",
  category: "fuel (pump prices)",
  name: "Prix des carburants en France – flux instantané v2",
  publisher: "Ministère de l'Économie via data.economie.gouv.fr",
  what_is_recorded: "Current pump price per litre at each filling station, by fuel type, with last-update time.",
  price_type: "posted_pump_price",
  freshness: "About every 10 minutes",
  licence: "Licence Ouverte / Etalab 2.0",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  attribution: "Source: Ministère de l'Économie – prix des carburants (Licence Ouverte / Etalab 2.0).",
  homepage: "https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/",
  limits:
    "Pump prices are what every customer pays at that station at that moment; they are posted prices, not individual receipts.",
};


const ENDPOINT =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

export const FR_FUELS = ["gazole", "sp95", "sp98", "e10", "e85", "gplc"] as const;
export type FrFuel = (typeof FR_FUELS)[number];

/** Our common fuel names -> the French feed's names. */
export const FR_NAME: Partial<Record<Fuel, FrFuel>> = {
  diesel: "gazole",
  petrol95: "sp95",
  petrol98: "sp98",
  e10: "e10",
  e85: "e85",
  lpg: "gplc",
};
const FUEL_LABEL: Record<FrFuel, string> = {
  gazole: "Diesel (Gazole)",
  sp95: "Unleaded 95 (SP95)",
  sp98: "Unleaded 98 (SP98)",
  e10: "Unleaded 95-E10",
  e85: "E85 bioethanol",
  gplc: "LPG (GPLc)",
};

export function buildFrUrl(where: string, offset: number): string {
  const p = new URLSearchParams({ where, limit: "100", offset: String(offset) });
  return `${ENDPOINT}?${p.toString()}`;
}

export function normalisePrice(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n > 20 ? n / 1000 : n; // older feeds used milli-euros
}

export interface Station {
  id: string;
  address: string;
  town: string;
  postcode: string;
  department: string | null;
  price: number;
  updated: string | null;
}

/** Department code from a record: the feed's own field, else derived from the postcode (Corsica 2A/2B, overseas 97x). */
export function frDepartment(r: any): string | null {
  const own = String(r?.code_departement ?? "").trim().toUpperCase();
  if (/^(\d{2,3}|2A|2B)$/.test(own)) return own;
  const cp = String(r?.cp ?? "").replace(/\D/g, "");
  if (cp.length !== 5) return null;
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  return cp.slice(0, 2);
}

export function parseFrRecords(json: any, fuel: FrFuel): Station[] {
  const recs = json?.results;
  if (!Array.isArray(recs)) throw new SourceError("Unexpected response from data.economie.gouv.fr");
  return recs
    .map((r: any) => ({
      id: String(r.id ?? ""),
      address: String(r.adresse ?? ""),
      town: String(r.ville ?? ""),
      postcode: String(r.cp ?? ""),
      department: frDepartment(r),
      price: normalisePrice(r[`${fuel}_prix`]),
      updated: r[`${fuel}_maj`] ? String(r[`${fuel}_maj`]) : null,
    }))
    .filter((s: Station) => Number.isFinite(s.price));
}

export async function frFuelNow(input: {
  postcode?: string;
  department?: string;
  fuel: FrFuel;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  let where: string;
  let area: string;
  if (input.postcode) {
    const cp = input.postcode.replace(/[^0-9]/g, "").slice(0, 5);
    where = `cp="${cp}"`;
    area = `postcode ${cp}`;
  } else if (input.department) {
    const d = input.department.replace(/[^0-9AB]/gi, "").toUpperCase().slice(0, 3);
    where = `code_departement="${d}"`;
    area = `department ${d}`;
  } else {
    throw new InputError("Give a French postcode or department code.");
  }
  const stations: Station[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const json = await fetchJson(buildFrUrl(where, offset), {}, 15000);
    const page = parseFrRecords(json, input.fuel);
    stations.push(...page);
    if (!Array.isArray(json?.results) || json.results.length < 100) break;
  }
  const s = summarise(stations.map((x) => x.price));
  const updates = stations.map((x) => x.updated).filter(Boolean).sort() as string[];
  const cheapest = [...stations].sort((a, b) => a.price - b.price).slice(0, 3).map(({ department, ...s }) => s);
  return buildAnswer({
    source: INFO,
    query: { country: "FR", postcode: input.postcode ?? null, department: input.department ?? null, fuel: input.fuel },
    summary: s,
    currency: "EUR",
    unit: "per litre",
    period: { from: updates[0]?.slice(0, 10) ?? null, to: updates[updates.length - 1]?.slice(0, 10) ?? null },
    method:
      "Median and 10th–90th percentile of the latest pump price per litre reported by each station in the area for the selected fuel.",
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]} in ${area} costs a median of ${fmtMoney(x.median, "EUR")}/litre right now; typical range ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: stations.length },
  });
}

const EXPORT_URL =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json";
const STALE_DAYS = 8;
/** National row: metropolitan France only (overseas departments have regulated, very different prices). */
const METRO = "ALL";

/** One day of aggregates for the price library: every department and fuel, plus France as a whole ("ALL").
 *  Prices not updated in the last 8 days are left out, so closed stations do not freeze the figures. */
export function frDailyRows(records: any[], today: string): HarvestResult {
  const cutoffMs = Date.parse(today + "T00:00:00Z") - STALE_DAYS * 86400000;
  const rows: { area: string; item: string; price: number }[] = [];
  for (const [common, fr] of Object.entries(FR_NAME) as [Fuel, FrFuel][]) {
    for (const st of parseFrRecords({ results: records }, fr)) {
      if (!st.department) continue;
      const t = st.updated ? Date.parse(st.updated) : NaN;
      if (Number.isFinite(t) && t < cutoffMs) continue;
      rows.push({ area: st.department, item: common, price: st.price });
      if (!st.department.startsWith("97") && !st.department.startsWith("98")) rows.push({ area: METRO, item: common, price: st.price });
    }
  }
  return { date: today, currency: "EUR", unit: "per litre", rows: aggregateDaily(rows, false) };
}

export async function frHarvest(): Promise<HarvestResult> {
  const fields = ["id", "cp", "code_departement", ...FR_FUELS.flatMap((f) => [`${f}_prix`, `${f}_maj`])].join(",");
  let records: any;
  try {
    records = await fetchJson(`${EXPORT_URL}?${new URLSearchParams({ select: fields })}`, {}, 180000);
  } catch {
    records = await fetchJson(EXPORT_URL, {}, 180000); // field list changed: take everything
  }
  if (!Array.isArray(records)) throw new SourceError("Unexpected export format from data.economie.gouv.fr");
  return frDailyRows(records, new Date().toISOString().slice(0, 10));
}

export function frHistoryKey(p: { postcode?: string; department?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!FR_NAME[p.fuel as Fuel]) return null;
  if (p.postcode) {
    const d = frDepartment({ cp: p.postcode });
    return d ? { area: d, item: p.fuel, label: `department ${d}` } : null;
  }
  if (p.department) {
    const d = p.department.trim().toUpperCase();
    return /^(\d{2,3}|2A|2B)$/.test(d) ? { area: d, item: p.fuel, label: `department ${d}` } : null;
  }
  return { area: "ALL", item: p.fuel, label: "metropolitan France" };
}
