// Manifest: day-ahead wholesale electricity for Romania (OPCOM, euro per MWh, 15-minute prices). Logic lives in ./source.ts.
import { defineSource, num } from "../../lib/plugin";
import { INFO, opcomHarvest, opcomHistoryKey, opcomSpot } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["RO"],
  countryHelp: "Day-ahead wholesale power for RO = Romania (OPCOM exchange, 15-minute prices in euro per MWh)",
  placeName: "Romania",
  status: "live",
  paramNotes: {
    market: "RO: the OPCOM day-ahead market (15-minute intervals). Only day-ahead is available.",
    lookback_days: "RO: 1 to 14 days of 15-minute prices (default 7), plus the next day once published (about 13:00 CET); each 15-minute interval counts as one record.",
    commodity: "RO: electricity only.",
  },
  examples: [{ params: { country: "RO" } }, { params: { country: "RO", lookback_days: "2" }, smoke: false }],
  method:
    "Romania wholesale power: the median and 10th-90th percentile of the 15-minute day-ahead clearing price (euro per MWh) over the last days, from the OPCOM Day-Ahead Market results. Exchange prices, not household bills.",
  handle: (p, ctx) => opcomSpot({ days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => opcomHarvest(),
  historyKey: (p) => opcomHistoryKey(String(p.country ?? "")),
});
