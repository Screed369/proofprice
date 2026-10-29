// Manifest: Singapore MRT and LRT posted fares (Public Transport Council fare table on data.gov.sg). Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, sgFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["SG"],
  countryHelp: "SG = Singapore (MRT and LRT card fares per ride from the Public Transport Council fare table, SGD, a posted tariff; bus fares not included)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    fare_type: "Singapore: adult (default), senior, student, workfare or disability.",
    distance_km: "Singapore: ride distance in km (default 5); the fare is read from the published 1 km band.",
    travel_time: "Singapore: early = before 7.45am on weekdays (discounted fares), other = all other times (default).",
  },
  examples: [
    { params: { country: "SG", distance_km: "8.5" } },
    { params: { country: "SG", fare_type: "student", distance_km: "12", travel_time: "early" }, smoke: false },
  ],
  method:
    "Singapore transport fares: the Public Transport Council's posted MRT/LRT card fare per ride for the chosen fare group, time band and distance band, converted to Singapore dollars. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    sgFares({ fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
});
