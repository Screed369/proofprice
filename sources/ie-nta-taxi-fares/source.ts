// Ireland: maximum taxi fares set by the National Transport Authority (NTA), Taxi Regulation (Maximum Fares) Order 2024, S.I. No. 479/2024,
// in operation from 2024-12-01. A fixed statutory tariff (a Schedule of numbers), not a data feed: the Schedule is held below as a typed table.
// Checked 2026-11-12 against https://www.irishstatutebook.ie/eli/2024/si/479/made/en/html (plain GET, 200, no key). The test parses a copy of the
// Schedule text (fixtures/si479-schedule.txt) and checks that this table still says what the statute says.
// Posted MAXIMUM fares: a driver may charge less. Not amounts paid by passengers.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const SOURCE_URL = "https://www.irishstatutebook.ie/eli/2024/si/479/made/en/html";
export const IN_FORCE = "2024-12-01";

export const INFO: SourceInfo = {
  id: "ie-nta-taxi-fares",
  country: "IE",
  category: "transport fares (Irish taxi maximum fares)",
  name: "Irish taxi maximum fares (Taxi Regulation (Maximum Fares) Order 2024, S.I. No. 479/2024)",
  publisher: "National Transport Authority (Ireland), published in the Irish Statute Book (Office of the Attorney General)",
  what_is_recorded:
    "The maximum fare a taxi driver in Ireland may charge, from the Schedule to S.I. No. 479/2024: the initial charge, the metered tariff per distance, and the standard, premium and special rates. " +
    "ProofPrice works out the maximum metered fare for a journey distance. A regulated maximum, not an amount paid.",
  price_type: "posted_price",
  freshness: "Fixed by statutory instrument; in operation from 1 December 2024 and unchanged until the National Transport Authority makes a new Order",
  licence: "Oireachtas (Open Data) PSI Licence, incorporating the Creative Commons Attribution 4.0 International licence",
  licence_url: "https://www.irishstatutebook.ie/open-data.html",
  attribution:
    "Contains Irish Statute Book data (S.I. No. 479/2024, Taxi Regulation (Maximum Fares) Order 2024), © Houses of the Oireachtas / Office of the Attorney General, " +
    "licensed under the Oireachtas (Open Data) PSI Licence incorporating CC BY 4.0 (https://www.irishstatutebook.ie/open-data.html). " +
    "ProofPrice works out the distance fare; this is not an official service of the National Transport Authority.",
  homepage: SOURCE_URL,
  limits:
    "Maximum metered fares set by law, not amounts paid and not a quote: a driver may charge less, and a fare agreed in advance for a fixed journey is outside this table. " +
    "The figure counts distance only (travelling faster than the 21.2 km/h changeover speed, no waiting or slow traffic); waiting time in traffic is charged at the hourly tariff and can raise the fare. " +
    "Booking fee, extra passengers, tolls and soiling charges are listed separately and not added. Rounded up to the next EUR 0.20 meter step, so it is within one step of the exact tariff. " +
    "Ireland-wide; ride-hailing apps that use fixed prices are not covered.",
};

export type RateKey = "standard" | "premium" | "special";

export interface Rate {
  label: string;
  applies: string;
  initial_eur: number; // initial charge, covers initial_m
  initial_m: number;
  step_eur: number; // monetary unit of the meter
  a_m: number; // distance allowance per step on Tariff A
  a_max_units: number | null; // steps of Tariff A before Tariff B (null = Tariff A for the whole journey)
  b_m: number | null; // distance allowance per step on Tariff B
  tariff_a_per_km: number;
  tariff_b_per_km: number | null;
  hourly_a: number;
  hourly_b: number | null;
}

/** The Schedule to S.I. 479/2024 (amounts in euro, distances in metres). */
export const RATES: Record<RateKey, Rate> = {
  standard: {
    label: "Standard rate (rate 1)",
    applies: "08:00 to 20:00, Monday to Saturday",
    initial_eur: 4.4, initial_m: 500, step_eur: 0.2,
    a_m: 151.5, a_max_units: 96, b_m: 116.3,
    tariff_a_per_km: 1.32, tariff_b_per_km: 1.72, hourly_a: 27.98, hourly_b: 36.46,
  },
  premium: {
    label: "Premium rate (rate 2)",
    applies: "20:00 to 08:00 Monday to Saturday, all day Sunday and public holidays (except Christmas and New Year), apart from the special-rate hours",
    initial_eur: 5.4, initial_m: 500, step_eur: 0.2,
    a_m: 110.5, a_max_units: 132, b_m: 90.9,
    tariff_a_per_km: 1.81, tariff_b_per_km: 2.2, hourly_a: 38.37, hourly_b: 46.64,
  },
  special: {
    label: "Special rate (rate 3)",
    applies: "Saturday and Sunday 00:00 to 04:00, Christmas Eve 20:00 to St Stephen's Day 08:00, New Year's Eve 20:00 to New Year's Day 08:00",
    initial_eur: 5.4, initial_m: 500, step_eur: 0.2,
    a_m: 90.9, a_max_units: null, b_m: null,
    tariff_a_per_km: 2.2, tariff_b_per_km: null, hourly_a: 46.64, hourly_b: null,
  },
};

export const EXTRAS = {
  booking_fee_eur: 3.0,
  additional_passenger_eur: 1.0,
  soiling_max_eur: 140.0,
  tolls: "charged as incurred under a road authority toll scheme",
};

/** Pure: the maximum metered fare in euro cents-exact for a distance in km (distance only, at or above the changeover speed). */
export function maxFare(rate: Rate, distanceKm: number): number {
  const initial = Math.round(rate.initial_eur * 100);
  const step = Math.round(rate.step_eur * 100);
  const d = distanceKm * 1000;
  if (d <= rate.initial_m) return initial / 100;
  let r = d - rate.initial_m;
  let units: number;
  if (rate.a_max_units === null || rate.b_m === null) {
    units = Math.ceil(r / rate.a_m - 1e-9);
  } else {
    const aRange = rate.a_max_units * rate.a_m;
    if (r <= aRange) units = Math.ceil(r / rate.a_m - 1e-9);
    else units = rate.a_max_units + Math.ceil((r - aRange) / rate.b_m - 1e-9);
  }
  return (initial + units * step) / 100;
}

const RATE_ALIASES: Record<string, RateKey> = {
  standard: "standard", "rate 1": "standard", "1": "standard", day: "standard", daytime: "standard", normal: "standard",
  premium: "premium", "rate 2": "premium", "2": "premium", night: "premium", evening: "premium", sunday: "premium",
  special: "special", "rate 3": "special", "3": "special", christmas: "special", "new year": "special", weekend: "special",
};

export function parseRate(v?: string): RateKey {
  const t = (v ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "standard";
  const k = RATE_ALIASES[t];
  if (!k) throw new InputError("taxi_rate must be standard (08:00-20:00 Mon-Sat, default), premium (evenings, nights, Sundays, public holidays) or special (Sat/Sun 00:00-04:00, Christmas and New Year).");
  return k;
}

export interface TaxiInput {
  distance_km?: number;
  taxi_rate?: string;
  fare_type?: string;
  travel_time?: string;
  baseUrl?: string;
}

const DEFAULT_KM = 5;

export function answerFromTariff(input: TaxiInput): PriceAnswer {
  if (input.fare_type && input.fare_type !== "adult") {
    throw new InputError("Irish taxi maximum fares do not depend on the passenger type: leave fare_type out (or adult).");
  }
  const key = parseRate(input.taxi_rate);
  const km = input.distance_km === undefined ? DEFAULT_KM : input.distance_km;
  if (!Number.isFinite(km) || km < 0 || km > 500) throw new InputError("distance_km must be a number of kilometres between 0 and 500, e.g. 10.");
  const rate = RATES[key];
  const fare = maxFare(rate, km);
  const exactKm = Math.round(km * 100) / 100;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "IE", taxi_rate: key, distance_km: exactKm },
    value: fare,
    measure: "average",
    currency: "EUR",
    unit: "per taxi journey (maximum metered fare, distance only)",
    period: { from: IN_FORCE, to: null },
    reference_period: `S.I. No. 479/2024, in operation from ${IN_FORCE}`,
    min: rate.initial_eur,
    max: null,
    method:
      "Ireland taxi: the maximum fare in the Schedule to the Taxi Regulation (Maximum Fares) Order 2024 (S.I. 479/2024). The headline is the initial charge plus the metered distance steps of EUR 0.20 (Tariff A, then Tariff B after the first range), for a journey at or above the 21.2 km/h changeover speed with no waiting time, rounded up to the next meter step. A regulated maximum, not an amount paid.",
    describe: (v) =>
      `The maximum metered taxi fare in Ireland for ${exactKm} km on the ${rate.label.toLowerCase()} is about EUR ${v.toFixed(2)} (initial charge EUR ${rate.initial_eur.toFixed(2)} for the first ${rate.initial_m} m), before any booking fee, extra passengers or tolls.`,
    ending: "Maximum fare set by the National Transport Authority under S.I. No. 479/2024; a driver may charge less.",
    evidence: {
      label: "Regulated maximum taxi fare",
      meaning: "The most a licensed taxi driver may charge for a metered journey under Irish law. It is a legal ceiling, not a record of what passengers paid.",
    },
    note: "Posted maximum, not an amount paid. Counts distance only; time spent waiting or in slow traffic is charged at the hourly tariff and can make the fare higher. Booking fee, extra passengers, tolls and soiling charges are not included.",
    baseUrl: input.baseUrl,
    extra: {
      rate: rate.label,
      rate_applies: rate.applies,
      initial_charge_eur: rate.initial_eur,
      initial_distance_m: rate.initial_m,
      tariff_a_per_km_eur: rate.tariff_a_per_km,
      tariff_b_per_km_eur: rate.tariff_b_per_km,
      hourly_tariff_a_eur: rate.hourly_a,
      hourly_tariff_b_eur: rate.hourly_b,
      extras: EXTRAS,
      mode: "Taxi (maximum metered fare)",
    },
  });
}

export async function ieTaxiFares(input: TaxiInput): Promise<PriceAnswer> {
  return answerFromTariff(input);
}
