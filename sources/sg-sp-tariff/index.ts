// Manifest: Singapore household electricity (SP Group annual tariff for domestic supplies, via SingStat on data.gov.sg). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, sgElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["SG"],
  countryHelp: "SG = Singapore (SP Group's published annual electricity tariff for domestic supplies, SGD per kWh excluding GST, a posted tariff)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    energy: "SG: electricity only (no gas).",
    consumption_band: "SG: one flat domestic tariff; leave out.",
    taxes: "SG: not used; the figure excludes GST.",
  },
  examples: [{ params: { country: "SG", energy: "electricity" } }],
  method:
    "Singapore electricity: SP Group's published tariff for domestic Low Tension supplies (cents per kWh excluding GST), latest calendar year, converted to dollars. A posted tariff, not a count of paid bills.",
  handle: (p, ctx) => sgElectricity({ energy: str(p.energy), consumption_band: str(p.consumption_band), baseUrl: ctx.baseUrl }),
});
