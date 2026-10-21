// Manifest: Canada fuel prices (Statistics Canada table 18-10-0001-01, monthly average retail prices by city). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import type { Fuel } from "../../lib/fuels";
import { readLatestDay } from "../../lib/library/store";
import { INFO, caFuelHarvest, caFuelHistoryKey, caFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["CA"],
  countryHelp: "CA = Canada (Statistics Canada: monthly average retail price by city, official statistic, not a live pump price)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    fuel: "Canada: petrol95 = regular unleaded gasoline (87 AKI, about 91 RON), petrol98 = premium unleaded, diesel; self-service stations. E10, E85, LPG and CNG are not published.",
    town: "Canada: one of the 18 cities Statistics Canada tracks (St. John's, Charlottetown and Summerside, Halifax, Saint John, Québec, Montréal, Ottawa-Gatineau, Toronto, Thunder Bay, Winnipeg, Regina, Saskatoon, Edmonton, Calgary, Vancouver, Victoria, Whitehorse, Yellowknife), or 'Canada' for the national average (regular unleaded only). Leave town and area out for the national average.",
    area: "Canada: same as town (a city, or 'Canada'). Provinces are not published.",
    postcode: "Canada: not used.",
    service: "Canada: self only. Full-service prices stopped in 2013.",
  },
  examples: [
    { params: { country: "CA", town: "Vancouver", fuel: "petrol95" } },
    { params: { country: "CA", town: "Toronto", fuel: "diesel" }, smoke: false },
  ],
  method:
    "Canada (fuel): Statistics Canada's monthly average retail price per litre of regular and premium unleaded gasoline and diesel at self-service stations for 18 cities and Canada, published with the Consumer Price Index (table 18-10-0001-01). " +
    "We pass on the published average and its month, with the change on the previous month and a year earlier; it is a monthly average, not a live pump price, and no range is calculated.",
  handle: (p, ctx) =>
    caFuelNow({
      fuel: p.fuel as Fuel,
      town: str(p.town),
      area: str(p.area),
      postcode: str(p.postcode),
      service: str(p.service),
      baseUrl: ctx.baseUrl,
    }),
  // A daily copy of the newest month, so a Statistics Canada outage is answered from it (stale-if-error). Rows are dated by the
  // reference month, each row is one published average (n is a placeholder), and there is no /history of these monthly averages.
  harvest: () => caFuelHarvest(),
  historyKey: (p) => caFuelHistoryKey({ fuel: str(p.fuel), town: str(p.town), area: str(p.area) }, [...new Set((readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area))]),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Canada: Statistics Canada publishes one average per city and month; ProofPrice keeps no daily history of it. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month, with the change on the previous month and a year earlier.",
});
