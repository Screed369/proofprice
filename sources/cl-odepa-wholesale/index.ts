// Manifest: Chile wholesale fruit and vegetable market prices (ODEPA open data, CKAN). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, MARKETS, clHarvest, clHistoryKey, clWholesale, productHelp } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-markets",
  countries: ["CL"],
  countryHelp: "CL = Chile (daily wholesale market records for fruit and vegetables)",
  placeName: "Chile",
  status: "live",
  paramNotes: {
    product:
      "CL: required. Fruit or vegetable by English or Spanish name, in CLP per kg (per unit for lettuce and other products sold by the piece): " + productHelp() + ". All quality grades are included.",
    market:
      "CL: optional wholesale market or fair: " + [...new Set(Object.keys(MARKETS))].join(", ") + ". Leave out for all markets together. Not every market trades every product.",
  },
  examples: [
    { params: { country: "CL", product: "tomato" } },
    { params: { country: "CL", product: "potato", market: "Lo Valledor" }, smoke: false },
    { params: { country: "CL", product: "lettuce" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => clWholesale({ product: str(p.product), market: str(p.market), baseUrl: ctx.baseUrl }),
  harvest: () => clHarvest(),
  historyKey: (p) => clHistoryKey({ country: String(p.country), product: String(p.product ?? "") }),
});
