// Manifest: Mexico Profeco "Quien es Quien en los Precios" shop shelf prices of everyday goods. Logic lives in ./source.ts.
// The daily collector (harvest) unpacks the newest yearly archive; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, profecoHarvest, profecoHistoryKey, profecoPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["MX"],
  countryHelp: "MX = Mexico",
  placeName: "Mexico (Profeco shelf prices)",
  status: "live",
  paramNotes: {
    item:
      "MX: an everyday product in English or Spanish ('milk', 'eggs', 'tortilla', 'rice', 'beans', 'sugar', 'cooking oil', 'leche', 'huevo', 'frijol'). Profeco names products in Spanish with a pack size, " +
      "so the answer names the exact product and pack and lists related ones. The 120 products priced in the most shops are held.",
    region: "MX: a state ('Jalisco', 'Nuevo Leon', 'Ciudad de Mexico', 'Yucatan', 'CDMX'); leave out for the national figure. A state needs 5 or more shops pricing the product.",
  },
  examples: [
    { params: { country: "MX", item: "milk" } },
    { params: { country: "MX", item: "eggs", region: "Jalisco" }, smoke: false },
  ],
  method:
    "Mexico (shop prices): Profeco's Quien es Quien en los Precios, collected once a day into our price library; an answer is the median and range across shops of each shop's newest price for a product and pack over the last 30 days of data, in pesos. " +
    "Posted shelf prices recorded by Profeco inspectors, not receipts; the file runs about 7 weeks behind.",
  handle: (p, ctx) => profecoPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: profecoHarvest,
  historyKey: (p) => profecoHistoryKey({ item: str(p.item), region: str(p.region) }),
});
