// Manifest: Argentina Precios Claros - Base SEPA, daily shelf prices of packaged everyday goods reported by supermarket chains. Logic lives in ./source.ts.
// The daily collector (harvest) downloads the newest weekday file (about 325 MB); requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, sepaHarvest, sepaHistoryKey, sepaPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["AR"],
  countryHelp: "AR = Argentina",
  placeName: "Argentina (Precios Claros supermarket shelf prices)",
  status: "live",
  paramNotes: {
    item:
      "AR: a packaged everyday product in English or Spanish ('milk', 'sugar', 'rice', 'yerba mate', 'cooking oil', 'pasta', 'flour', 'butter', 'coffee', 'leche', 'azucar', 'arroz', 'aceite', 'fideos'). " +
      "Chains name products in Spanish with the pack size, so the answer names the exact product and pack and lists related ones. About 100 products priced in the most shops are held; loose fruit, vegetables and meat are not.",
    region: "AR: a province ('Buenos Aires', 'Cordoba', 'Mendoza', 'Santa Fe', 'CABA' for the city of Buenos Aires); leave out for the national figure. A province needs 5 or more shops pricing the product.",
  },
  examples: [
    { params: { country: "AR", item: "milk" } },
    { params: { country: "AR", item: "yerba mate", region: "Cordoba" }, smoke: false },
  ],
  method:
    "Argentina (shop prices): Precios Claros - Base SEPA, the list prices that supermarket chains report every day under Resolucion 12/2016, collected once a day into our price library; an answer is the median and range across shops of the list price of one product (one EAN barcode) in the newest daily file, in pesos. " +
    "Posted shelf prices reported by the chains, not receipts; promotions are ignored.",
  handle: (p, ctx) => sepaPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: sepaHarvest,
  historyKey: (p) => sepaHistoryKey({ item: str(p.item), region: str(p.region) }),
});
