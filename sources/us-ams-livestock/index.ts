// Manifest: US fed cattle prices (USDA AMS Livestock Mandatory Price Reporting, LM_CT154). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, exampleProducts, livestockHarvest, livestockHistoryKey, usLivestock } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["US"],
  countryHelp: "US = United States (USDA AMS: weekly average price packers paid for fed steers and heifers, negotiated cash purchases, national, not monthly)",
  placeName: "United States",
  status: "live",
  paramNotes: {
    product: `United States: fed cattle in everyday words, e.g. ${exampleProducts()}. Prices are US dollars per hundredweight (100 lb), live or dressed weight as the answer says. The answer is for the newest weekly report, not a month.`,
  },
  examples: [{ params: { country: "US", product: "cattle" } }, { params: { country: "US", product: "dressed heifers" }, smoke: false }],
  method:
    "United States (fed cattle): USDA AMS Livestock Mandatory Price Reporting, the head-weighted average price packers paid for negotiated cash purchases in the newest weekly report, with head bought as the sample size; collected daily into our price library.",
  handle: (p, ctx) => usLivestock({ product: String(p.product ?? ""), baseUrl: ctx.baseUrl }),
  harvest: () => livestockHarvest(),
  historyKey: (p) => livestockHistoryKey({ product: str(p.product) }),
});
