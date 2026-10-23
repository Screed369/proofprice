// Manifest: Great Britain household electricity and gas, the Ofgem energy price cap (default tariffs). Logic lives in ./source.ts.
// Answers household requests only; GB business prices are answered by gb-desnz-energy-business (sector=business).
import { defineSource, str } from "../../lib/plugin";
import { INFO, ofgemCap } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["GB"],
  countryHelp: "Household: GB = Great Britain (England, Scotland, Wales), Ofgem price cap on default tariffs, pence per kWh, Direct Debit national average; no Northern Ireland",
  placeName: "Great Britain (price cap)",
  status: "live",
  serves: (p) => p.sector !== "business",
  paramNotes: {
    energy: "GB household: electricity or gas; the Ofgem price cap unit rate in pounds per kWh, with the daily standing charge.",
    consumption_band: "GB household: not used (Ofgem sets one unit rate per fuel).",
    taxes: "GB household: only the default 'all' (the cap as published, including VAT: 5% on gas, 0% on electricity from 1 October 2026).",
  },
  examples: [
    { params: { country: "GB", energy: "electricity" } },
    { params: { country: "GB", energy: "gas" }, smoke: false },
  ],
  method:
    "Great Britain household energy: the Ofgem price cap on the unit rate for default tariffs, set every quarter, national Direct Debit average. We pass on the published figure and its period; it is a regulated maximum, not a list of sales.",
  handle: (p, ctx) => ofgemCap({ energy: String(p.energy), taxes: str(p.taxes), consumption_band: str(p.consumption_band), baseUrl: ctx.baseUrl }),
});
