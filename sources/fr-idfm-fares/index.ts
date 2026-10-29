// Manifest: Île-de-France posted public transport fares (Île-de-France Mobilités tariff list). Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, idfmFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["FR"],
  countryHelp: "FR = France (Île-de-France only: the Paris region single ticket and Navigo-type passes from the Île-de-France Mobilités tariff list, EUR, a posted tariff)",
  placeName: "Paris region",
  status: "live",
  paramNotes: {
    fare_type: "France (Île-de-France): adult = single ticket Métro-Train-RER (default); student = annual Imagine R student pass. Seniors and disabled people get percentage discounts, not a fixed fare.",
    distance_km: "France (Île-de-France): not used, the single ticket costs the same for any distance in the region.",
    travel_time: "France (Île-de-France): no early band; leave out.",
  },
  examples: [
    { params: { country: "FR" } },
    { params: { country: "FR", fare_type: "student" }, smoke: false },
  ],
  method:
    "Paris region transport fares: the posted price of the matching ticket or pass in the Île-de-France Mobilités tariff list, in euros. A posted list price, not amounts paid.",
  handle: (p, ctx) =>
    idfmFares({ fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
});
