// Manifest: Costa Rica regulated maximum pump prices (ARESEP). Logic lives in ./source.ts. Answers come from the price library (the tariff file is 11 MB).
import { defineSource, str } from "../../lib/plugin";
import { INFO, crFuelNow, crHarvest, crHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["CR"],
  countryHelp: "CR = Costa Rica (regulator ARESEP: national maximum price, not a station price)",
  placeName: "Costa Rica",
  status: "live",
  paramNotes: {
    fuel: "Costa Rica: petrol95 (Gasolina RON 95) or diesel (automotive, 50 ppm), the regulated maximum price in colones per litre with IVA. Gasolina RON 91 is given in the answer as extra information.",
    postcode: "Costa Rica: not used; one national price is returned and says so.",
    area: "Costa Rica: not used (national price only).",
    town: "Costa Rica: not used (national price only).",
    service: "Costa Rica: not used.",
  },
  examples: [{ params: { country: "CR", fuel: "diesel" } }, { params: { country: "CR", fuel: "petrol95" }, smoke: false }],
  method:
    "Costa Rica (fuel): the regulator ARESEP fixes a maximum consumer price per litre for petrol and diesel and publishes each tariff with its start date. " +
    "We copy the file daily and pass on the price in force; no range is calculated.",
  handle: (p, ctx) => crFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => crHarvest(),
  historyKey: (p) => crHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Costa Rica: ARESEP fixes one price per fuel, changed about once a month; ProofPrice keeps no daily history of it. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the price in force.",
});
