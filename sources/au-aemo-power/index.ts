// Manifest: Australia wholesale electricity (AEMO National Electricity Market regional spot prices). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { z } from "zod";
import { INFO, aemoBackfill, aemoHarvest, aemoHistoryKey, aemoSpot } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["AU"],
  countryHelp: "AU = Australia (National Electricity Market, five regions; prices in Australian dollars per MWh, not euro)",
  placeName: "Australia",
  status: "live",
  serves: (p) => String(p.commodity ?? "").toLowerCase() !== "gas",
  paramNotes: {
    market: "AU: spot only (AEMO's five-minute regional price), not day-ahead; leave it out.",
    lookback_days: "AU: 1 to 7 trading days of five-minute prices (default 3); each five-minute interval counts as one record. Prices are in Australian dollars (AUD) per MWh.",
  },
  extraParams: {
    region: z
      .string()
      .optional()
      .describe("AU only: NEM region NSW1 (New South Wales incl. ACT, default), QLD1, SA1, TAS1 or VIC1; short names like NSW, VIC or Queensland also work."),
  },
  examples: [
    { params: { country: "AU" } },
    { params: { country: "AU", region: "SA1", lookback_days: "2" }, smoke: false },
  ],
  method:
    "Australia wholesale power: the median and 10th-90th percentile of AEMO's five-minute regional reference prices (Australian dollars per MWh) for one National Electricity Market region over the last days, from AEMO's daily price files. Spot market prices, not household bills.",
  handle: (p, ctx) => aemoSpot({ region: str(p.region), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => aemoHarvest(),
  backfill: (from, to) => aemoBackfill(from, to),
  historyKey: (p) => aemoHistoryKey(str(p.region)),
});
