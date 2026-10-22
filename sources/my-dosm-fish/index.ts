// Manifest: Malaysia monthly fish and seafood prices (OpenDOSM fish_prices). Logic lives in ./source.ts.
// The daily collector reads the catalogue CSV; requests are answered from the price library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { INFO, fishHarvest, fishHistoryKey, myFish } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["MY"],
  countryHelp: "MY = Malaysia (Department of Statistics Malaysia: monthly average fish and seafood prices per kg at landing, wholesale and retail, official statistic, not a live price)",
  placeName: "Malaysia",
  status: "live",
  paramNotes: {
    product:
      "Malaysia: a fish or seafood in English or Malay, e.g. mackerel, kembong, tenggiri, pomfret, bawal_putih, prawn, udang_harimau, squid, sotong_katak, crab, siakap, kerapu, bilis. About 150 kinds are published; a word that fits several (mackerel, prawn) returns the list to choose from. Prices are in ringgit per kg.",
    region: "Malaysia: ignored; the fish prices are national.",
  },
  extraParams: {
    level: z.string().optional().describe("Malaysia fish only: ex_vessel (the price fishers get at first sale at landing; default), wholesale or retail."),
  },
  examples: [
    { params: { country: "MY", product: "kembong" } },
    { params: { country: "MY", product: "squid", level: "retail" }, smoke: false },
  ],
  method:
    "Malaysia fish prices: the Department of Statistics Malaysia's monthly average price per kilogram for about 150 kinds of fish and seafood at three levels (ex-vessel, wholesale, retail), collected daily from the OpenDOSM catalogue into our price library. " +
    "We pass on the newest published average and its month; it is a monthly average, not a sale or a live price, with no range or sample size.",
  handle: async (p, ctx) => myFish({ product: String(p.product ?? ""), level: str(p.level), baseUrl: ctx.baseUrl }, () => readLatestDay(INFO.id)),
  harvest: () => fishHarvest(),
  historyKey: (p) => fishHistoryKey({ product: str(p.product), level: str(p.level) }, readLatestDay(INFO.id)?.rows ?? []),
  referenceDates: true,
  nominalCounts: true,
});
