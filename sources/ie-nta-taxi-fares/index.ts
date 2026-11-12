// Manifest: Irish taxi maximum fares (National Transport Authority, S.I. No. 479/2024). Logic lives in ./source.ts.
// A fixed statutory tariff: no fetch and no harvest. Shares the approved category "transport-fares" (country IE has no other source there).
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, ieTaxiFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["IE"],
  countryHelp: "IE = Ireland (taxi MAXIMUM metered fare for a journey distance, from the National Transport Authority's Order S.I. 479/2024, EUR, a regulated ceiling not an amount paid; no train, bus or Luas fares)",
  placeName: "Ireland (taxi maximum fares)",
  status: "live",
  paramNotes: {
    fare_type: "Ireland (taxi): not used; the maximum fare is the same for every passenger. Leave out.",
    distance_km: "Ireland (taxi): the journey distance in km (default 5); the maximum metered fare is worked out from the statutory tariff.",
    travel_time: "Ireland (taxi): not used; use taxi_rate (standard, premium or special) to say when you travel.",
  },
  extraParams: {
    taxi_rate: z.string().optional().describe("IE only: standard (08:00-20:00 Mon-Sat, default), premium (20:00-08:00, Sundays and public holidays) or special (Sat/Sun 00:00-04:00, Christmas and New Year)."),
  },
  examples: [
    { params: { country: "IE", distance_km: "10" } },
    { params: { country: "IE", distance_km: "25", taxi_rate: "premium" }, smoke: false },
  ],
  method:
    "Irish taxis: the maximum metered fare for a journey distance from the National Transport Authority's statutory tariff (S.I. 479/2024, in operation from 1 December 2024), in euro, distance only and rounded up to the next EUR 0.20 meter step. A regulated maximum, not an amount paid.",
  handle: (p, ctx) =>
    ieTaxiFares({ distance_km: num(p.distance_km), taxi_rate: str(p.taxi_rate), fare_type: str(p.fare_type), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
});
