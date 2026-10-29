// Manifest: Hong Kong fuel (Consumer Council Oil Watch posted pump prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, hkFuel, hkHarvest, hkHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (posted pump prices of five oil companies, Consumer Council; posted prices, not station prices)",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    fuel: "HK: diesel, petrol95 (the Consumer Council's standard petrol) or petrol98 (premium petrol), in HKD per litre; the answer is the median of five companies' posted prices.",
    town: "HK: not used. Prices are for the whole territory; any place is answered with the Hong Kong figure and the answer says so.",
    area: "HK: not used (territory-wide figure only).",
    postcode: "HK: not used (territory-wide figure only).",
    service: "HK: not used.",
  },
  examples: [
    { params: { country: "HK", fuel: "diesel" } },
    { params: { country: "HK", fuel: "petrol95" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => hkFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  nominalCounts: true,
  harvest: () => hkHarvest(),
  historyKey: (p) => hkHistoryKey({ country: String(p.country), fuel: String(p.fuel) }),
});
