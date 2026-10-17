// Manifest: day-ahead wholesale electricity for AT, BE, DK, FR, IT, NL, NO, PL (Energy-Charts, Fraunhofer ISE). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { z } from "zod";
import { COUNTRIES, INFO, energyChartsDayAhead, energyChartsHarvest, energyChartsHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Day-ahead wholesale power for " +
    Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    " (Germany is DE, served separately)",
  placeName: "Austria, Belgium, Denmark, France, northern Italy, the Netherlands, south-west Norway and Poland",
  status: "live",
  paramNotes: {
    market: "AT/BE/DK/FR/IT/NL/NO/PL: day-ahead only (the auction held the day before delivery).",
    lookback_days: "AT/BE/DK/FR/IT/NL/NO/PL: 1 to 14 days of hourly average prices (default 7); each hour counts as one record.",
  },
  extraParams: {
    zone: z
      .string()
      .optional()
      .describe("Bidding zone, only where a country has more than one: DK = DK1 (west, default) or DK2 (east). IT answers northern Italy (IT-North), NO south-west Norway (NO2); other countries have one zone."),
  },
  examples: [
    { params: { country: "FR" } },
    { params: { country: "DK", zone: "DK2", lookback_days: "3" }, smoke: false },
    { params: { country: "NL" } },
  ],
  method:
    "Austria, Belgium, Denmark, France, Italy (north), the Netherlands, Norway (south-west) and Poland wholesale power: the median and 10th-90th percentile of the hourly average day-ahead auction prices (euro per MWh) over the last days, from Energy-Charts (Fraunhofer ISE). Exchange prices, not household bills. Only zones published under CC BY 4.0 are included.",
  handle: (p, ctx) =>
    energyChartsDayAhead({ country: String(p.country), zone: str(p.zone), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => energyChartsHarvest(),
  historyKey: (p) => energyChartsHistoryKey(String(p.country ?? "")),
});
