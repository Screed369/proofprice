// Manifest: Norway monthly national average pump prices (Statistics Norway, table 09654). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, noFuelHarvest, noFuelHistoryKey, noFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["NO"],
  countryHelp: "NO = Norway (Statistics Norway: monthly national average pump price, official statistic, not a live pump price)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    fuel: "Norway: petrol95 (95-octane unleaded) or diesel, as a national monthly average per litre in NOK with taxes. Premium petrol, E10, E85, LPG and CNG are not published.",
    postcode: "Norway: not used; SSB publishes one national average, so the national figure is returned and says so.",
    area: "Norway: not used (national average only).",
    town: "Norway: not used (national average only).",
    service: "Norway: not used.",
  },
  examples: [{ params: { country: "NO", fuel: "diesel" } }, { params: { country: "NO", fuel: "petrol95" }, smoke: false }],
  method:
    "Norway (fuel): Statistics Norway (SSB) publishes the national average pump price per litre of 95-octane petrol and diesel for every month, taxes included (table 09654). " +
    "We pass on the published average for the newest month, with the change on the previous month and a year earlier; no range is calculated.",
  handle: (p, ctx) => noFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so an SSB outage is answered from it (stale-if-error). Rows are dated by the reference month.
  harvest: () => noFuelHarvest(),
  historyKey: (p) => noFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Norway: SSB publishes one average per fuel and month; ProofPrice keeps no daily history of it. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month, with the change on the previous month and a year earlier.",
});
