// France live pump prices from the Ministère de l'Économie open feed (updated ~every 10 minutes).
// Station addresses are business addresses and are returned for the cheapest stations.

import { fetchJson, SourceError } from "../http";
import { summarise } from "../stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../answer";

const ENDPOINT =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

export const FR_FUELS = ["gazole", "sp95", "sp98", "e10", "e85", "gplc"] as const;
export type FrFuel = (typeof FR_FUELS)[number];
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
  price: number;
  updated: string | null;
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
    throw new SourceError("Give a French postcode or department code.");
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
  const cheapest = [...stations].sort((a, b) => a.price - b.price).slice(0, 3);
  return buildAnswer({
    sourceId: "fr-fuel",
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
