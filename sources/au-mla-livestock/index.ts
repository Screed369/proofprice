// Manifest: Australia saleyard livestock indicators (Meat & Livestock Australia NLRS). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, auLivestock, exampleProducts, livestockHarvest, livestockHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["AU"],
  countryHelp: "AU = Australia (Meat & Livestock Australia: daily weighted average saleyard auction prices for cattle and sheep, national indicators, not monthly)",
  placeName: "Australia",
  status: "live",
  paramNotes: {
    product: `Australia: cattle or sheep in everyday words, e.g. ${exampleProducts(14)}. Prices are Australian dollars: cents per kg (carcase or live weight, the answer says which) or dollars per head for the online indicators. The answer is for the newest trading day, not a month.`,
  },
  examples: [
    { params: { country: "AU", product: "cattle" } },
    { params: { country: "AU", product: "lamb" }, smoke: false },
  ],
  method:
    "Australia (saleyard livestock): Meat & Livestock Australia's National Livestock Reporting Service indicators, the weighted average price paid at saleyard auctions on the newest trading day, with the animals sold as the sample size; collected daily into our price library.",
  handle: (p, ctx) => auLivestock({ product: String(p.product ?? ""), baseUrl: ctx.baseUrl }),
  harvest: () => livestockHarvest(),
  historyKey: (p) => livestockHistoryKey({ product: str(p.product) }),
});
