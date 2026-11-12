// Manifest: Prague (PID) posted public transport fares from the open GTFS feed. Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, pidFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["CZ"],
  countryHelp: "CZ = Czechia (Prague and the PID region only: the posted adult single ticket from the PID open fare table, CZK, a posted tariff)",
  placeName: "Prague",
  status: "live",
  paramNotes: {
    fare_type: "Czechia (Prague): only adult (default); the open fare table has no reduced fares.",
    distance_km: "Czechia (Prague): not used, one ticket price covers any distance inside the tariff zones.",
    travel_time: "Czechia (Prague): no early band; leave out.",
  },
  examples: [{ params: { country: "CZ" } }],
  method: "Prague transport fares: the posted adult single-ticket price in the PID fare table (ROPID open data), in Czech koruna. A posted list price, not amounts paid.",
  handle: (p, ctx) => pidFares({ fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
});
