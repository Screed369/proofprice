// Manifest: United States BUSINESS (commercial-sector) electricity and natural gas prices by state (EIA). Logic lives in ./source.ts.
// Answers only when sector=business; household requests for the US go to sources/us-eia-energy. The `state` parameter is declared there.
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { INFO, usBusinessEnergy } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["US"],
  countryHelp: "With sector=business, US = United States (EIA: average commercial-sector electricity price in cents per kWh and commercial natural gas price in US$ per thousand cubic feet, by state, monthly)",
  placeName: "the United States (business)",
  status: "live",
  serves: (p) => p.sector === "business",
  paramNotes: {
    sector: "US: sector=business gives the EIA commercial-sector average (shops, offices, hospitals, schools and other service businesses); household prices are the default.",
    energy:
      "Business US: electricity = average commercial-sector price (answered in US dollars per kWh, also in cents; the industrial-sector price is in the extras); gas = average commercial natural gas price in US dollars per thousand cubic feet (Mcf). " +
      "EIA gives gas per Mcf, not per kWh, so the two cannot be compared directly.",
    consumption_band: "Business US: not used (EIA publishes one commercial average per state, no consumption bands).",
    taxes: "Business US: not used (EIA publishes one average per state).",
  },
  examples: [
    { params: { country: "US", sector: "business", energy: "electricity", state: "TX" } },
    { params: { country: "US", sector: "business", energy: "gas", state: "NY" }, smoke: false },
  ],
  method:
    "United States business energy: the average price of electricity and of natural gas sold to commercial-sector customers that the U.S. Energy Information Administration publishes every month for each state and the U.S. " +
    "(electricity in cents per kWh, natural gas in US dollars per thousand cubic feet). We pass on the published average; no range is calculated.",
  handle: (p, ctx) => {
    if (p.sector !== "business") {
      throw new InputError("Use the household source for household prices.");
    }
    return usBusinessEnergy({ energy: String(p.energy), state: str(p.state), baseUrl: ctx.baseUrl });
  },
});
