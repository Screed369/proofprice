// Manifest: Taiwan household electricity (Taipower published residential tariff, data.gov.tw dataset 17060). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, twElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Taipower's published residential electricity tariff: average price per kWh for a month's use, TWD, a posted tariff)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    energy: "TW: electricity only (no gas).",
    consumption_band: "TW: monthly use: 'standard' (default, 330 kWh), 'low' (120 kWh), 'high' (700 kWh) or a number of kWh a month (1 to 5000).",
    taxes: "TW: not used; the figure is the published tariff before any tax or surcharge.",
  },
  extraParams: {
    season: z.string().optional().describe("TW only: 'non_summer' (default) or 'summer' rates (Taipower charges more in summer)."),
  },
  examples: [
    { params: { country: "TW", energy: "electricity" } },
    { params: { country: "TW", energy: "electricity", consumption_band: "700", season: "summer" }, smoke: false },
  ],
  method:
    "Taiwan electricity: Taipower's published residential tariff table; the average price per kWh is the bill for a month's use, charged tier by tier, divided by the kWh used. A posted tariff, not a count of paid bills.",
  handle: (p, ctx) =>
    twElectricity({ energy: str(p.energy), consumption_band: str(p.consumption_band), season: str(p.season), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
