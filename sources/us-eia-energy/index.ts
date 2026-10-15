// Manifest: United States average residential electricity and natural gas prices by state (EIA). Logic lives in ./source.ts.
// The daily collector (harvest) copies EIA's two monthly tables into the price library; requests are answered from the library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, usEnergy, usEnergyHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["US"],
  countryHelp:
    "US = United States (U.S. Energy Information Administration: average residential electricity price in cents per kWh and residential natural gas price in US$ per thousand cubic feet, by state, monthly)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    energy:
      "US: electricity = average residential price in US cents per kWh (Electric Power Monthly); gas = average residential natural gas price in US dollars per thousand cubic feet (Natural Gas Monthly). " +
      "EIA gives gas per Mcf, not per kWh, so the two cannot be compared directly.",
    consumption_band: "US: not used (EIA publishes one average for all residential customers in a state).",
    taxes: "US: not used (EIA publishes one average per state).",
  },
  extraParams: {
    state: z
      .string()
      .optional()
      .describe("US only: the state, by name or postal code ('Texas', 'TX', 'DC'). Leave out for the U.S. average. Gas: EIA publishes no figure for a few states in recent months, then the newest published month is returned and the answer says so."),
  },
  examples: [
    { params: { country: "US", energy: "electricity", state: "TX" } },
    { params: { country: "US", energy: "gas", state: "NY" }, smoke: true },
  ],
  method:
    "United States energy: the average price of electricity and of natural gas sold to residential customers that the U.S. Energy Information Administration publishes every month for each state and the U.S. " +
    "(electricity in cents per kWh, natural gas in US dollars per thousand cubic feet), with the same month a year earlier. We copy EIA's two tables once a day and pass on the published average; no range is calculated.",
  nominalCounts: true,
  harvest: usEnergyHarvest,
  handle: (p, ctx) =>
    usEnergy({
      energy: String(p.energy),
      state: str(p.state),
      baseUrl: ctx.baseUrl,
    }),
});
