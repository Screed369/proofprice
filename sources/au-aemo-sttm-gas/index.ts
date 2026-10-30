// Manifest: Australia wholesale gas (AEMO STTM hub ex post prices, AUD per GJ). Logic lives in ./source.ts.
// Shares category "wholesale-power" with au-aemo-power: commodity=gas selects this source (serves() in both folders).
import { defineSource, num, str } from "../../lib/plugin";
import { z } from "zod";
import { INFO, sttmBackfill, sttmGas, sttmHarvest, sttmHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["AU"],
  countryHelp: "AU = Australia (with commodity=gas: AEMO Short Term Trading Market hubs Adelaide, Brisbane, Sydney; prices in Australian dollars per GJ)",
  placeName: "Australia (gas)",
  status: "live",
  serves: (p) => String(p.commodity ?? "").toLowerCase() === "gas",
  paramNotes: {
    market: "AU gas: daily hub price (STTM ex post), not day-ahead; leave it out.",
    lookback_days: "AU gas: 1 to 7 gas days (default 7); each hub gas day counts as one record, so ask for at least 5. Prices are in Australian dollars (AUD) per GJ.",
  },
  extraParams: {
    hub: z
      .string()
      .optional()
      .describe("AU gas only: STTM hub ADL (Adelaide), BRI (Brisbane) or SYD (Sydney, default); short names like NSW, QLD or SA also work."),
  },
  examples: [{ params: { country: "AU", commodity: "gas" } }, { params: { country: "AU", commodity: "gas", hub: "ADL", lookback_days: "5" }, smoke: false }],
  method:
    "Australia wholesale gas: the median and 10th-90th percentile of the daily ex post imbalance prices (Australian dollars per GJ) at one AEMO Short Term Trading Market hub over the last gas days. Hub prices, not household gas bills.",
  handle: (p, ctx) => sttmGas({ hub: str(p.hub), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => sttmHarvest(),
  backfill: (from, to) => sttmBackfill(from, to),
  historyKey: (p) => sttmHistoryKey(str(p.hub)),
});
