// Manifest: spot wholesale electricity for Great Britain (Elexon BMRS market index, pounds per MWh). Logic lives in ./source.ts.
import { defineSource, num } from "../../lib/plugin";
import { INFO, elexonHarvest, elexonHistoryKey, elexonSpot } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["GB"],
  countryHelp: "Spot wholesale power for GB = Great Britain (Elexon market index, in pounds per MWh)",
  placeName: "Great Britain",
  status: "live",
  paramNotes: {
    market: "GB: the half-hourly spot market index (traded prices); the day-ahead option is not used. Prices are in pounds, not euro.",
    lookback_days: "GB: 1 to 14 days of half-hourly prices (default 7); each half-hour with traded volume counts as one record.",
  },
  examples: [{ params: { country: "GB" } }, { params: { country: "GB", lookback_days: "2" }, smoke: false }],
  method:
    "Great Britain wholesale power: the median and 10th-90th percentile of the half-hourly traded spot price (pounds per MWh) over the last days, from the Elexon BMRS market index. Exchange prices, not household bills.",
  handle: (p, ctx) => elexonSpot({ days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => elexonHarvest(),
  historyKey: (p) => elexonHistoryKey(String(p.country ?? "")),
});
