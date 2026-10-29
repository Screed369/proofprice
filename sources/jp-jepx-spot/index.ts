// Manifest: Japan day-ahead wholesale electricity (JEPX spot market). Logic lives in ./source.ts.
// The daily collector (harvest) copies the JEPX fiscal-year CSV into the price library; requests are answered from the library.
import { defineSource, num } from "../../lib/plugin";
import { INFO, jepxDayAhead, jepxHarvest, jepxHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-power",
  countries: ["JP"],
  countryHelp: "JP = Japan (JEPX day-ahead spot market, half-hourly, in yen per kWh)",
  placeName: "Japan",
  status: "live",
  paramNotes: {
    market: "JP: day-ahead only (the spot market cleared the day before delivery). Prices are in yen per kWh, not euro per MWh.",
    lookback_days: "JP: 1 to 14. The headline figure is always the newest complete delivery day (48 half-hours); lookback_days adds the daily medians of the earlier days we hold under extra.daily.",
  },
  examples: [{ params: { country: "JP" } }, { params: { country: "JP", lookback_days: "3" }, smoke: false }],
  method:
    "Japan wholesale power: the median and 10th-90th percentile of the half-hourly day-ahead spot prices (nationwide system price, yen per kWh) for the newest complete delivery day, from the JEPX results file. Exchange prices, not household bills.",
  handle: (p, ctx) => jepxDayAhead({ country: String(p.country), days: num(p.lookback_days), baseUrl: ctx.baseUrl }),
  harvest: () => jepxHarvest(),
  historyKey: (p) => jepxHistoryKey(String(p.country ?? "")),
});
