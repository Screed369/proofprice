// Manifest: Germany/Luxembourg wholesale electricity (SMARD day-ahead prices, Bundesnetzagentur). Logic lives in ./source.ts.
import { defineSource, num } from "../../lib/plugin";
import { INFO, smardDayAhead, smardBackfill, smardHarvest, smardHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["DE"],
  countryHelp: "DE = Germany (Germany/Luxembourg bidding zone, SMARD day-ahead hourly auction prices)",
  placeName: "Germany",
  status: "live",
  paramNotes: {
    market: "DE: day-ahead only (the hourly auction held the day before delivery).",
    lookback_days: "DE: 1 to 14 days of hourly prices (default 7); each hour counts as one record.",
  },
  examples: [{ params: { country: "DE" } }, { params: { country: "DE", lookback_days: "3" }, smoke: false }],
  method:
    "Germany wholesale power: the median and 10th-90th percentile of the hourly day-ahead auction prices (euro per MWh) for the Germany/Luxembourg bidding zone over the last days, from the Bundesnetzagentur's SMARD service. Exchange prices, not household bills.",
  handle: (p, ctx) => smardDayAhead({ days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => smardHarvest(),
  backfill: (from, to) => smardBackfill(from, to),
  historyKey: () => smardHistoryKey(),
});
