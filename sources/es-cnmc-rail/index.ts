// Manifest: Spain high-speed rail fares from Madrid (CNMC monthly average posted web fare by route and operator). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, esRailFares, esRailHarvest, esRailHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["ES"],
  countryHelp: "ES = Spain (high-speed rail from Madrid to Barcelona, Valencia, Alicante, Málaga or Sevilla: CNMC's monthly average posted web fare per operator, EUR; a posted fare, not tickets sold)",
  placeName: "Spain high-speed rail",
  status: "live",
  paramNotes: {
    fare_type: "Spain (rail): not used, CNMC publishes one average fare per route and operator; leave out.",
    distance_km: "Spain (rail): not used, the fare is per route; give route instead.",
    travel_time: "Spain (rail): not used, CNMC averages over departure times and purchase days; leave out.",
  },
  extraParams: {
    route: z.string().optional().describe("Spain (rail) only: Madrid-Barcelona (default), Madrid-Valencia, Madrid-Alicante, Madrid-Málaga or Madrid-Sevilla, or just the destination (Barcelona, Seville...)."),
    operator: z.string().optional().describe("Spain (rail) only: total = all operators together (default), renfe-ave, renfe-avlo, iryo or ouigo. An operator CNMC did not see on that route in the newest month gives an error listing those it did."),
  },
  examples: [
    { params: { country: "ES" } },
    { params: { country: "ES", route: "Madrid-Valencia", operator: "ouigo" }, smoke: false },
    { params: { country: "ES", route: "Sevilla", operator: "iryo" }, smoke: false },
  ],
  method:
    "Spain high-speed rail: CNMC's monthly average posted web fare for a one-way ticket on five Madrid routes, per operator and for all operators together, passed on as published. A posted fare indicator read from the operators' websites, not tickets sold; no sample size.",
  handle: (p, ctx) =>
    esRailFares({ route: str(p.route), operator: str(p.operator), fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
  // Library copy: the newest month for every route and operator, dated by the month's last day (stale-if-error, and a monthly history).
  harvest: () => esRailHarvest(),
  historyKey: (p) => esRailHistoryKey({ route: str(p.route), operator: str(p.operator) }),
  referenceDates: true,
  staleMaxDays: 35,
  nominalCounts: true,
});
