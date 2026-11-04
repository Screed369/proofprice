// Manifest: Switzerland monthly wholesale reference prices for renewable power (BFE, opendata.swiss). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, chReference } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (BFE monthly reference market price for renewable power, CHF per MWh excluding VAT; an official statistic, not hourly day-ahead)",
  placeName: "Switzerland",
  status: "live",
  serves: (p) => String(p.commodity ?? "").toLowerCase() !== "gas",
  paramNotes: {
    commodity: "CH: electricity only (no gas).",
    market: "CH: a monthly reference price set by BFE, not the day-ahead auction; leave it out.",
    lookback_days: "CH: ignored; the answer is the newest month, with the last 12 months in extra.last_12_months.",
  },
  extraParams: {
    technology: z
      .string()
      .optional()
      .describe("CH only: all (default, volume-weighted across technologies), pv (solar), hydro, wind or biomass."),
  },
  examples: [
    { params: { country: "CH" } },
    { params: { country: "CH", technology: "hydro" }, smoke: false },
  ],
  method:
    "Switzerland wholesale power: the monthly reference market price the Swiss Federal Office of Energy (BFE) publishes for renewable electricity (all technologies volume-weighted, or solar, hydro, wind, biomass), newest month, in CHF per MWh excluding VAT. An official statistic, not an hourly price.",
  handle: (p, ctx) => chReference({ technology: str(p.technology), commodity: str(p.commodity), lookback_days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
});
