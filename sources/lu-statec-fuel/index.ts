// Manifest: Luxembourg fuel (monthly national average E10 pump price, Ministry of the Economy / STATEC, data.public.lu). Logic in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, luFuel, luFuelHarvest, luFuelHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["LU"],
  countryHelp: "LU = Luxembourg (monthly national average E10 petrol price in euro, all taxes included; an official statistic, not a station price). Diesel, petrol95 and lpg come from the weekly EU Oil Bulletin.",
  placeName: "Luxembourg",
  status: "live",
  // Shares LU with eu-oil-bulletin (weekly, fresher, diesel/petrol95/lpg/heating oil). This source adds the one fuel the bulletin lacks: E10.
  serves: (p) => String(p.country ?? "").toUpperCase() === "LU" && String(p.fuel ?? "") === "e10" && str(p.tax) !== "without",
  paramNotes: {
    fuel: "LU: e10 = monthly national average E10 price per litre incl. taxes (Ministry of the Economy, prices from STATEC). diesel, petrol95, lpg and heating_oil: the EU Weekly Oil Bulletin answers.",
    town: "LU: not used. One national price per month; any place is answered with the Luxembourg average and the answer says so.",
    area: "LU: not used (national price only).",
    postcode: "LU: not used (national price only).",
  },
  examples: [{ params: { country: "LU", fuel: "e10" } }],
  method:
    "Luxembourg fuel: the Ministry of the Economy's monthly national average pump price (prices from STATEC) of E10 petrol, all taxes included, for the newest month, with the change on three months and a year earlier. A national official statistic, not a station price.",
  handle: (p, ctx) => luFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => luFuelHarvest(),
  historyKey: (p) => luFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Luxembourg: ProofPrice keeps no separate daily history of this monthly series; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month, with the change on three months and a year earlier.",
});
