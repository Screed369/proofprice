// Manifest: day-ahead wholesale electricity for Spain and Portugal (OMIE marginal price files). Logic lives in ./source.ts.
import { defineSource, num } from "../../lib/plugin";
import { COUNTRIES, INFO, omieDayAhead, omieHarvest, omieHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: Object.keys(COUNTRIES),
  countryHelp: "Day-ahead wholesale power for ES = Spain and PT = Portugal (Iberian market, OMIE)",
  placeName: "Spain and Portugal",
  status: "live",
  paramNotes: {
    market: "ES/PT: day-ahead only (the auction held the day before delivery).",
    lookback_days: "ES/PT: 1 to 14 days of hourly average prices (default 7); each hour counts as one record.",
  },
  examples: [{ params: { country: "ES" } }, { params: { country: "PT", lookback_days: "3" }, smoke: false }],
  method:
    "Spain and Portugal wholesale power: the median and 10th-90th percentile of the hourly average day-ahead auction prices (euro per MWh) over the last days, from the OMIE marginal price files. Exchange prices, not household bills.",
  handle: (p, ctx) => omieDayAhead({ country: String(p.country), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => omieHarvest(),
  historyKey: (p) => omieHistoryKey(String(p.country ?? "")),
});
