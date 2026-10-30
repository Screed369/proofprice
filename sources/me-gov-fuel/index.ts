// Manifest: Montenegro government maximum fuel prices (data.gov.me). Logic lives in ./source.ts. Answers come from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, meFuelNow, meHarvest, meHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["ME"],
  countryHelp: "ME = Montenegro (government maximum price, not a station price)",
  placeName: "Montenegro",
  status: "live",
  paramNotes: {
    fuel: "Montenegro: petrol95 (Eurosuper 95) or diesel (Eurodiesel), the government maximum retail price in euro per litre with taxes. Eurosuper 98 and heating oil are given in the answer as extra information.",
    postcode: "Montenegro: not used; one national price is returned and says so.",
    area: "Montenegro: not used (national price only).",
    town: "Montenegro: not used (national price only).",
    service: "Montenegro: not used.",
  },
  examples: [{ params: { country: "ME", fuel: "diesel" } }, { params: { country: "ME", fuel: "petrol95" }, smoke: false }],
  method:
    "Montenegro (fuel): the government fixes maximum retail prices per litre for petrol, diesel and heating oil about every week and publishes each notice on data.gov.me. " +
    "We copy the notice daily and pass on the price in force; no range is calculated.",
  handle: (p, ctx) => meFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => meHarvest(),
  historyKey: (p) => meHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Montenegro: the government fixes one price per fuel, changed about weekly; ProofPrice keeps no daily history of it. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the price in force.",
});
