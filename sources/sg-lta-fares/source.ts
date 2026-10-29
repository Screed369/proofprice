// Singapore MRT and LRT fares: the Public Transport Council's posted fare table (card fares per ride, by fare group, time band and distance band).
// Format checked live on 2026-10-29 through the GitHub probe: plain GET, no key, CKAN-style datastore_search on data.gov.sg,
// resource d_2ca29f673b89e0cfddbb7c74516fa4d3 (390 rows = 5 fare types x 2 time bands x 39 distance bands; fields fare_type,
// applicable_time, distance, fare_per_ride (cents, numeric text), _id). Posted tariff, not paid. Bus fares are NOT in this file.

import { ckanSearch } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const RESOURCE_ID = "d_2ca29f673b89e0cfddbb7c74516fa4d3";
export const SITE = "https://data.gov.sg/api/action";

export const INFO: SourceInfo = {
  id: "sg-lta-fares",
  country: "SG",
  category: "transport fares (MRT and LRT)",
  name: "MRT and LRT card fares by distance, Public Transport Council fare table",
  publisher: "Land Transport Authority / Public Transport Council of Singapore, published on data.gov.sg",
  what_is_recorded:
    "The posted fare per ride (cents) on the MRT and LRT for each fare group (adult, senior citizen, student, workfare, persons with disabilities), time band and distance band. A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated when fares change (yearly fare review; the table read 29 Oct 2026 carried the fares effective from 27 Dec 2025)",
  licence: "Singapore Open Data Licence v1.0 (worldwide, perpetual, royalty-free use of the datasets, commercially or non-commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from the MRT and LRT fare table (Land Transport Authority / Public Transport Council) accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). " +
    "ProofPrice converts cents to dollars and looks up the distance band; this is not an official service of the agencies.",
  homepage: "https://data.gov.sg/datasets/d_2ca29f673b89e0cfddbb7c74516fa4d3/view",
  limits:
    "Card fares per MRT/LRT ride from the published table, not amounts paid, not a ticket and not a quote. Bus fares, cash tickets, passes and concession schemes outside the five fare groups are not included. No sample size.",
};

export type FareGroup = "adult" | "senior" | "student" | "workfare" | "disability";
export type TimeBand = "early" | "other";

export interface FareRow {
  group: FareGroup;
  band: TimeBand;
  /** Lower and upper end of the distance band in km (upper is Infinity for "Over 40.2 km"). */
  from: number;
  to: number;
  label: string;
  cents: number;
}

const GROUP_LABEL: Record<FareGroup, string> = {
  adult: "adult card fare",
  senior: "senior citizen card fare",
  student: "student card fare",
  workfare: "Workfare transport concession card fare",
  disability: "card fare for persons with disabilities",
};

function groupOf(t: string): FareGroup | null {
  const s = t.toLowerCase();
  if (s.startsWith("adult")) return "adult";
  if (s.startsWith("senior")) return "senior";
  if (s.startsWith("student")) return "student";
  if (s.startsWith("workfare")) return "workfare";
  if (s.startsWith("persons with")) return "disability";
  return null;
}

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

/** Pure: turn datastore records into fare rows. Unknown groups or distance texts are skipped; an empty result is an error. */
export function parseFares(records: Record<string, any>[]): FareRow[] {
  const out: FareRow[] = [];
  for (const r of records) {
    const group = groupOf(String(r?.fare_type ?? ""));
    const d = parseDistance(String(r?.distance ?? ""));
    const cents = Number(r?.fare_per_ride);
    if (!group || !d || !Number.isFinite(cents) || cents < 0) continue;
    const band: TimeBand = /before 7\.45/i.test(String(r?.applicable_time ?? "")) ? "early" : "other";
    out.push({ group, band, from: d.from, to: d.to, label: String(r.distance).trim(), cents });
  }
  if (out.length < 40) throw new SourceError("The MRT fare table has far fewer rows than expected; this source needs updating.");
  return out;
}

export interface FareInput {
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  baseUrl?: string;
}

const METHOD =
  "Singapore MRT and LRT: the Public Transport Council's posted card fare per ride for the chosen fare group, time band and distance band, from the table on data.gov.sg, converted from cents to Singapore dollars. " +
  "A published fare table, the same for everyone in the group, not a count of fares paid; bus fares are not included.";

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromFares(rows: FareRow[], input: FareInput): PriceAnswer {
  const group = ((input.fare_type ?? "adult").toString().toLowerCase() as FareGroup);
  if (!(group in GROUP_LABEL)) throw new InputError("fare_type for SG must be adult, senior, student, workfare or disability.");
  const band = ((input.travel_time ?? "other").toString().toLowerCase() as TimeBand);
  if (band !== "early" && band !== "other") throw new InputError('travel_time must be "early" (before 7.45am on weekdays) or "other".');
  const km = input.distance_km === undefined ? 5 : input.distance_km;
  if (!Number.isFinite(km) || km < 0) throw new InputError("distance_km must be a number of kilometres, e.g. 8.5.");
  const candidates = rows.filter((r) => r.group === group && r.band === band).sort((a, b) => a.from - b.from);
  // Bands are 1 km wide with 0.1 km gaps (3.2 | 3.3): a distance in a gap belongs to the band above it.
  const hit = candidates.find((r) => km <= r.to);
  if (!hit) throw new SourceError("No fare band found for that request in the MRT fare table.");
  const dollars = hit.cents / 100;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "SG", fare_type: group, distance_km: km, travel_time: band },
    value: dollars,
    measure: "average",
    currency: "SGD",
    unit: "per ride (MRT/LRT card fare)",
    period: { from: "2025-12-27", to: null },
    reference_period: "fares effective 27 Dec 2025",
    method: METHOD,
    describe: (v) =>
      `The posted MRT/LRT ${GROUP_LABEL[group]} in Singapore for a ride of ${hit.label} (${band === "early" ? "before 7.45am on weekdays" : "all other times"}) is SGD ${v.toFixed(2)} per ride.`,
    note: "Posted fare table, not an amount paid. Bus fares are not included.",
    baseUrl: input.baseUrl,
    extra: { fare_group: group, time_band: band, distance_band: hit.label, cents: hit.cents, mode: "MRT and LRT" },
  });
}

export async function sgFares(input: FareInput, fetcher?: () => Promise<Record<string, any>[]>): Promise<PriceAnswer> {
  const records = fetcher ? await fetcher() : (await ckanSearch(SITE, { resourceId: RESOURCE_ID, limit: 400 })).records;
  return answerFromFares(parseFares(records), input);
}
