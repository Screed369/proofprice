// Manifest: California wholesale electricity (CAISO OASIS day-ahead hourly prices, USD per MWh). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { z } from "zod";
import { INFO, caisoHarvest, caisoHistoryKey, caisoSpot } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["US"],
  countryHelp: "US = California only (CAISO day-ahead market, hourly prices at three trading hubs, in US dollars per MWh, not euro)",
  placeName: "California (United States)",
  status: "live",
  serves: (p) => String(p.commodity ?? "").toLowerCase() !== "gas",
  paramNotes: {
    market: "US: day-ahead only (CAISO's hourly day-ahead market price); leave it out.",
    lookback_days: "US: 1 to 14 days of hourly prices (default 7), plus tomorrow once published (about 13:00 Pacific); each delivery hour counts as one record. Prices are in US dollars (USD) per MWh, not euro.",
    commodity: "US: electricity only (California).",
  },
  extraParams: {
    trading_hub: z.string().optional().describe("US only: CAISO trading hub NP15 (northern California, default), SP15 (southern) or ZP26 (central); north, south and central also work."),
  },
  examples: [
    { params: { country: "US" } },
    { params: { country: "US", trading_hub: "SP15", lookback_days: "2" }, smoke: false },
  ],
  method:
    "California wholesale power: the median and 10th-90th percentile of CAISO's hourly day-ahead market prices (US dollars per MWh) at one trading hub over the last days, from CAISO OASIS. Market prices, not household bills.",
  handle: (p, ctx) => caisoSpot({ hub: str(p.trading_hub), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => caisoHarvest(),
  historyKey: (p) => caisoHistoryKey(str(p.trading_hub)),
});
