// Manifest: Taiwan fuel (CPC Corporation posted pump list prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, twFuel, twHarvest, twHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (posted island-wide list price of CPC Corporation; a posted price, not a station price)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    fuel: "TW: diesel (premium diesel), petrol95 (95 unleaded) or petrol98 (98 unleaded), in NT$ per litre with VAT and excise. 92 unleaded and 95E3 gasohol are in the extra fields.",
    town: "TW: not used. CPC posts one island-wide price; any place is answered with the Taiwan price and the answer says so.",
    area: "TW: not used (island-wide price only).",
    postcode: "TW: not used (island-wide price only).",
    service: "TW: not used.",
  },
  examples: [
    { params: { country: "TW", fuel: "diesel" } },
    { params: { country: "TW", fuel: "petrol95" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => twFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  nominalCounts: true,
  harvest: () => twHarvest(),
  historyKey: (p) => twHistoryKey({ country: String(p.country), fuel: String(p.fuel) }),
});
