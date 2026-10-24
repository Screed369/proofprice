// Manifest: Malaysia fuel (data.gov.my weekly set prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, myFuel, myFuelHarvest, myFuelHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["MY"],
  countryHelp: "MY = Malaysia (weekly government-set national price; an official published price, not a station price)",
  placeName: "Malaysia",
  status: "live",
  paramNotes: {
    fuel: "MY: diesel, petrol95 (RON95, unsubsidised rate) or petrol98 (answered with RON97). Subsidised BUDI95/SKPS/SKDS prices are in extra.subsidised_myr_per_litre.",
    town: "MY: not used. One national price per week; any place is answered with the Malaysia price and the answer says so.",
    area: "MY: not used (national price only).",
    postcode: "MY: not used (national price only).",
    service: "MY: not used.",
  },
  examples: [
    { params: { country: "MY", fuel: "diesel" } },
    { params: { country: "MY", fuel: "petrol95" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => myFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => myFuelHarvest(),
  historyKey: (p) => myFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Malaysia: ProofPrice keeps no separate weekly history of the data.gov.my series yet; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest week, with the change on the week before and a year earlier.",
});
