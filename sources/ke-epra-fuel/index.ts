// Manifest: Kenya regulated maximum pump prices by town (EPRA). Logic lives in ./source.ts. Answers come from the price library (the EPRA page is 7 MB).
import { defineSource, str } from "../../lib/plugin";
import { INFO, keFuelNow, keHarvest, keHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["KE"],
  countryHelp: "KE = Kenya (regulator EPRA: monthly maximum price per town, not a station price)",
  placeName: "Kenya",
  status: "live",
  paramNotes: {
    fuel: "Kenya: petrol95 (Super PMS) or diesel (AGO), the regulated maximum price in Kenya shillings per litre. Kerosene is given in the answer as extra information.",
    town: "Kenya: the town as EPRA lists it (for example Nairobi, Kisumu, Nakuru, Eldoret, Voi). Without a town the price for Nairobi is returned and says so.",
    area: "Kenya: same as town.",
    postcode: "Kenya: not used.",
    service: "Kenya: not used.",
  },
  examples: [{ params: { country: "KE", fuel: "diesel", town: "Nairobi" } }, { params: { country: "KE", fuel: "petrol95", town: "Kisumu" }, smoke: false }],
  method:
    "Kenya (fuel): the regulator EPRA publishes a monthly table of maximum retail pump prices per town. " +
    "We copy it daily and pass on the price for the period in force; no range is calculated.",
  handle: (p, ctx) => keFuelNow({ fuel: String(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => keHarvest(),
  historyKey: (p) => keHistoryKey({ fuel: str(p.fuel), town: str(p.town), area: str(p.area) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Kenya: EPRA fixes one price per town and fuel each month; ProofPrice keeps a daily copy but the figure changes only monthly. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the price in force.",
});
