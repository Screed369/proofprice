// Manifest: Uruguay everyday shop shelf prices (Defensa del Consumidor, Sistema de Informacion de Precios al Consumidor). Logic lives in ./source.ts.
// The daily collector (harvest) reads only the tail of the 1.5 GB yearly file; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, uyHarvest, uyHistoryKey, uyPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["UY"],
  countryHelp: "UY = Uruguay (Defensa del Consumidor shelf prices reported by shops, UYU with IVA; newest data is usually several weeks old)",
  placeName: "Uruguay (consumer ministry shelf prices)",
  status: "live",
  paramNotes: {
    item:
      "UY: an everyday product in English or Spanish ('rice', 'sugar', 'eggs', 'chicken', 'bananas', 'cooking oil', 'toilet paper', 'arroz', 'azucar', 'pollo'). The ministry names each product with a pack size, " +
      "so the answer names the exact product and pack and lists related ones. The 160 products priced in the most shops are held. Fresh milk is not in the file (only dulce de leche, butter and yogurt).",
    region: "UY: a department ('Montevideo', 'Canelones', 'Maldonado', 'Salto', 'Colonia'); leave out for the national figure. A department needs 5 or more shops pricing the product.",
  },
  examples: [
    { params: { country: "UY", item: "rice" } },
    { params: { country: "UY", item: "rice", region: "Montevideo" }, smoke: false },
  ],
  method:
    "Uruguay (shop prices): the consumer ministry's Sistema de Informacion de Precios al Consumidor, collected once a day into our price library (only the newest week of the 1.5 GB yearly file is read); an answer is the median and range across shops of each shop's newest regular price for a product and pack over the last 7 days of data, in Uruguayan pesos with IVA. " +
    "Posted shelf prices reported to the ministry, not receipts; special offers are left out.",
  handle: (p, ctx) => uyPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => uyHarvest(),
  historyKey: (p) => uyHistoryKey({ item: str(p.item), region: str(p.region) }),
});
