// Manifest: Taiwan fish and seafood wholesale market prices (Ministry of Agriculture open data). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, productHelp, twFish, twHarvest, twHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (daily trading prices at the wholesale fish markets, with a range from the market averages)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    product:
      "TW: fish and seafood by English or Taiwanese name, in NT$ per kg from the wholesale fish markets: " + productHelp() +
      ". Frozen products are left out. The answer is a range (median, 10th to 90th percentile) over the newest three trading days.",
  },
  examples: [
    { params: { country: "TW", product: "tilapia" } },
    { params: { country: "TW", product: "white shrimp" }, smoke: false },
    { params: { country: "TW", product: "salmon" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => twFish({ product: str(p.product), baseUrl: ctx.baseUrl }),
  harvest: () => twHarvest(),
  historyKey: (p) => twHistoryKey({ country: String(p.country), product: String(p.product ?? "") }),
});
