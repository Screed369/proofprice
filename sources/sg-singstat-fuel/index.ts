// Manifest: Singapore fuel (SingStat monthly national average pump prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, sgFuel, sgFuelHarvest, sgFuelHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["SG"],
  countryHelp: "SG = Singapore (Department of Statistics monthly national average pump price; an official statistic, not a station price)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    fuel: "SG: diesel, petrol95, petrol98 (92-octane petrol is in extra.other_fuels) or lpg (per kg).",
    town: "SG: not used. One national price per month; any place is answered with the Singapore average and the answer says so.",
    area: "SG: not used (national price only).",
    postcode: "SG: not used (national price only).",
  },
  examples: [
    { params: { country: "SG", fuel: "petrol95" } },
    { params: { country: "SG", fuel: "diesel" }, smoke: false },
  ],
  method:
    "Singapore fuel: SingStat's monthly national average retail price of petrol (92/95/98 octane), diesel and LPG for the newest month, with the change on the month and the year. A national official statistic, not a station price.",
  handle: (p, ctx) => sgFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => sgFuelHarvest(),
  historyKey: (p) => sgFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Singapore: ProofPrice keeps a daily copy of SingStat's newest month; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month with the change on the month before and a year earlier.",
});
