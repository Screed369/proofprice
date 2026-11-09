// Manifest: Argentina wholesale fruit and vegetable prices (Mercado Central de Buenos Aires daily price lists). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, arHarvest, arHistoryKey, arWholesale, productHelp } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-markets",
  countries: ["AR"],
  countryHelp: "AR = Argentina (daily posted wholesale prices at the Mercado Central de Buenos Aires)",
  placeName: "Argentina",
  status: "live",
  paramNotes: {
    product:
      "AR: required. Fruit or vegetable by English or Spanish name, in ARS per kg: " + productHelp() + ". All varieties, origins and grades are included.",
    market:
      "AR: only one market is published (Mercado Central de Buenos Aires), so this is not needed; leave it out.",
  },
  examples: [
    { params: { country: "AR", product: "tomato" } },
    { params: { country: "AR", product: "banana" }, smoke: false },
    { params: { country: "AR", product: "potato" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => arWholesale({ product: str(p.product), market: str(p.market), baseUrl: ctx.baseUrl }),
  harvest: () => arHarvest(),
  historyKey: (p) => arHistoryKey({ country: String(p.country), product: String(p.product ?? "") }),
});
