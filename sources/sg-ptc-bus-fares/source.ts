// Singapore trunk bus fares: the Public Transport Council's posted fare table (fare per ride by distance band, fare group, card or cash).
// Format checked live on 2026-11-05: plain GET, no key, CKAN-style datastore_search on data.gov.sg, resource
// d_828dcf144fe4f82c85c53d15a19e920f (39 rows = distance bands; columns distance, <group>_card_fare_per_ride, <group>_cash_fare_per_ride,
// numeric text in SGD CENTS; dataset "Fares for Trunk Bus Services (Cents) (Effective 27 December 2025)"). Posted tariff, not paid.
// Fares change once a year (December), so there is no harvest().

import { ckanSearch } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const RESOURCE_ID = "d_828dcf144fe4f82c85c53d15a19e920f";
export const SITE = "https://data.gov.sg/api/action";

export const INFO: SourceInfo = {
  id: "sg-ptc-bus-fares",
  country: "SG",
  category: "transport fares (trunk bus)",
  name: "Trunk bus fares by distance, Public Transport Council fare table",
  publisher: "Public Transport Council of Singapore, published on data.gov.sg",
  what_is_recorded:
    "The posted fare per ride (cents) on trunk bus services for each distance band, fare group (adult, senior citizen, student, workfare, persons with disabilities) and payment method (card or cash). A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated when fares change (yearly fare review; the table read 5 Nov 2026 carried the fares effective from 27 Dec 2025)",
  licence: "Singapore Open Data Licence v1.0 (worldwide, perpetual, royalty-free use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from the Fares for Trunk Bus Services table (Public Transport Council) accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). " +
    "ProofPrice converts cents to dollars and looks up the distance band; this is not an official service of the agency.",
  homepage: "https://data.gov.sg/dataset/fare-structure-for-trunk-bus-services",
  limits:
    "Trunk bus fares per ride from the published table, not amounts paid, not a ticket and not a quote. Feeder buses, express and premium services, passes and concession schemes outside the five fare groups are not included. No sample size.",
};

export type FareGroup = "adult" | "senior" | "student" | "workfare" | "disability";
export type Payment = "card" | "cash";

export interface BusFareRow {
  /** Lower and upper end of the distance band in km (upper is Infinity for "Over 40.2 km"). */
  from: number;
  to: number;
  label: string;
  /** cents[group][payment] */
  cents: Record<FareGroup, Record<Payment, number>>;
}

const GROUP_COLUMN: Record<FareGroup, string> = {
  adult: "adult",
  senior: "senior_citizen",
  student: "student",
  workfare: "workfare_transport_concession",
  disability: "persons_with_disabilities",
};
const GROUP_LABEL: Record<FareGroup, string> = {
  adult: "adult",
  senior: "senior citizen",
  student: "student",
  workfare: "Workfare transport concession",
  disability: "persons with disabilities",
};

/** Pure: "Up to 3.2 km" -> [0, 3.2]; "3.3 km - 4.2 km" -> [3.3, 4.2]; "Over 40.2 km" -> [40.2, Infinity]. */
export function parseDistance(text: string): { from: number; to: number } | null {
  const s = text.trim().toLowerCase();
  let m = s.match(/^up to ([\d.]+) km$/);
  if (m) return { from: 0, to: Number(m[1]) };
  m = s.match(/^([\d.]+) km\s*-\s*([\d.]+) km$/);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  m = s.match(/^over ([\d.]+) km$/);
  if (m) return { from: Number(m[1]), to: Infinity };
  return null;
}

/** Pure: turn datastore records into distance-band rows. Rows with an unknown distance text or a missing/negative fare are skipped; too few rows is an error. */
export function parseBusFares(records: Record<string, any>[]): BusFareRow[] {
  const out: BusFareRow[] = [];
  for (const r of records) {
    const d = parseDistance(String(r?.distance ?? ""));
    if (!d) continue;
    const cents = {} as BusFareRow["cents"];
    let ok = true;
    for (const g of Object.keys(GROUP_COLUMN) as FareGroup[]) {
      cents[g] = { card: NaN, cash: NaN };
      for (const p of ["card", "cash"] as Payment[]) {
        const v = Number(r?.[`${GROUP_COLUMN[g]}_${p}_fare_per_ride`]);
        if (!Number.isFinite(v) || v < 0) ok = false;
        cents[g][p] = v;
      }
    }
    if (ok) out.push({ from: d.from, to: d.to, label: String(r.distance).trim(), cents });
  }
  if (out.length < 20) throw new SourceError("The trunk bus fare table has far fewer rows than expected; this source needs updating.");
  return out.sort((a, b) => a.from - b.from);
}

export interface BusFareInput {
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  payment?: string;
  baseUrl?: string;
}

const METHOD =
  "Singapore trunk bus: the Public Transport Council's posted fare per ride for the chosen fare group, payment method and distance band, from the table on data.gov.sg, converted from cents to Singapore dollars. " +
  "A published fare table, the same for everyone in the group, not a count of fares paid; MRT and LRT fares are a separate table.";

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromBusFares(rows: BusFareRow[], input: BusFareInput): PriceAnswer {
  const group = (input.fare_type ?? "adult").toString().toLowerCase() as FareGroup;
  if (!(group in GROUP_COLUMN)) throw new InputError("fare_type for SG bus must be adult, senior, student, workfare or disability.");
  const payment = (input.payment ?? "card").toString().toLowerCase() as Payment;
  if (payment !== "card" && payment !== "cash") throw new InputError('payment for SG bus must be "card" (default) or "cash".');
  const km = input.distance_km === undefined ? 5 : input.distance_km;
  if (!Number.isFinite(km) || km < 0) throw new InputError("distance_km must be a number of kilometres, e.g. 8.5.");
  // Bands are 1 km wide with 0.1 km gaps (3.2 | 3.3): a distance in a gap belongs to the band above it.
  const hit = rows.find((r) => km <= r.to);
  if (!hit) throw new SourceError("No fare band found for that request in the trunk bus fare table.");
  const cents = hit.cents[group][payment];
  const dollars = cents / 100;
  const earlyNote = input.travel_time && input.travel_time.toString().toLowerCase() === "early" ? " Buses have no early-morning discount: the full fare is shown." : "";
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SG", service: "bus", fare_type: group, distance_km: km, payment },
    value: dollars,
    measure: "average",
    currency: "SGD",
    unit: "per ride (trunk bus fare)",
    period: { from: "2025-12-27", to: null },
    reference_period: "fares effective 27 Dec 2025",
    method: METHOD,
    describe: (v) =>
      `The posted trunk bus ${payment} fare for ${GROUP_LABEL[group]} in Singapore for a ride of ${hit.label} is SGD ${v.toFixed(2)} per ride.`,
    note: `Posted fare table, not an amount paid. Trunk bus services only; MRT and LRT fares are answered without service=bus.${earlyNote}`,
    baseUrl: input.baseUrl,
    extra: { fare_group: group, payment, distance_band: hit.label, cents, mode: "trunk bus" },
  });
}

export async function sgBusFares(input: BusFareInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 100 })).records;
  return answerFromBusFares(parseBusFares(records), input);
}
