// Manifest: Thailand fuel (EPPO monthly national retail oil prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, thFuel, thFuelHarvest, thFuelHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["TH"],
  countryHelp: "TH = Thailand (EPPO monthly national average retail price; an official statistic, not a station price)",
  placeName: "Thailand",
  status: "live",
  paramNotes: {
    fuel: "TH: petrol95 (ULG 95; petrol98 gets the same series), diesel (HSD B7) or lpg (automotive LPG per litre). Gasoline 91 and kerosene are in extra.other_products.",
    town: "TH: not used. EPPO publishes one national price per month; any place is answered with the Thailand average and the answer says so.",
    area: "TH: not used (national price only).",
    postcode: "TH: not used (national price only).",
    service: "TH: not used.",
  },
  examples: [
    { params: { country: "TH", fuel: "diesel" } },
    { params: { country: "TH", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Thailand fuel: EPPO's monthly national weighted-average retail price of ULG 95 gasoline, HSD B7 diesel and automotive LPG for the newest month, with the lowest and highest brand price and the change on the month and year. A national official statistic, not a station price.",
  handle: (p, ctx) => thFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => thFuelHarvest(),
  historyKey: (p) => thFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Thailand: ProofPrice keeps no separate monthly history of the EPPO series; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month, with the change on the month before and a year earlier.",
});
