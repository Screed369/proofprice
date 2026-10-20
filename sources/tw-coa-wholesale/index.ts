// Manifest: Taiwan wholesale vegetable and fruit market prices (Council of Agriculture open data). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, productHelp, twHarvest, twHistoryKey, twWholesale, MARKETS } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-markets",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (daily trading averages at the wholesale vegetable and fruit markets)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    product:
      "TW: required. Vegetable or fruit by English name or Taiwanese name, in NT$ per kg: " + productHelp() +
      ". Imported produce is left out unless fewer than 5 domestic records exist.",
    market:
      "TW: optional wholesale market: " + Object.keys(MARKETS).join(", ") + " (or the Taiwanese name such as 西螺). Leave out for all markets together. Not every market trades every product.",
  },
  examples: [
    { params: { country: "TW", product: "cabbage" } },
    { params: { country: "TW", product: "banana" }, smoke: false },
    { params: { country: "TW", product: "tomato", market: "Taipei" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => twWholesale({ product: str(p.product), market: str(p.market), baseUrl: ctx.baseUrl }),
  harvest: () => twHarvest(),
  historyKey: (p) => twHistoryKey({ country: String(p.country), product: String(p.product ?? "") }),
});
