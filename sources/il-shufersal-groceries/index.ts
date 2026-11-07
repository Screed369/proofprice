// Manifest: Israel supermarket shelf prices from Shufersal's published price files. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, shufersalHarvest, shufersalHistoryKey, shufersalPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["IL"],
  countryHelp: "IL = Israel (Shufersal supermarket chain, posted shelf prices from its daily price-transparency files)",
  placeName: "Israel",
  status: "beta",
  paramNotes: {
    item:
      "IL: one of a fixed basket in English ('milk', 'eggs', 'bread', 'wholemeal bread', 'rice', 'flour', 'canola oil', 'sunflower oil', 'tomatoes', 'cucumbers', 'potatoes', 'bananas', 'chicken breast', 'cottage cheese', 'butter'). " +
      "The answer is the median and range of Shufersal's posted shelf prices across its stores, per kg, per litre or per egg, and names the product group. One chain only. No region option.",
  },
  examples: [{ params: { country: "IL", item: "eggs" } }, { params: { country: "IL", item: "milk" }, smoke: false }],
  method:
    "Israel (posted shelf prices, one chain): Shufersal's daily price-transparency files, one per store; a fixed basket picked by barcode, converted to a price per kg, litre or piece, one price per store; median and 10th–90th percentile across stores in shekels. Posted prices, not receipts.",
  handle: (p, ctx) => shufersalPrices({ item: str(p.item), baseUrl: ctx.baseUrl }),
  harvest: shufersalHarvest,
  historyKey: (p) => shufersalHistoryKey({ item: str(p.item) }),
});
