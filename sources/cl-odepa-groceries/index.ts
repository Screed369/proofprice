// Manifest: Chile ODEPA "Precios al Consumidor" weekly shop shelf prices of everyday food. Logic lives in ./source.ts.
// The daily collector (harvest) reads the newest 4 weeks from ODEPA's CKAN datastore; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, odepaHarvest, odepaHistoryKey, odepaPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["CL"],
  countryHelp: "CL = Chile (ODEPA weekly shelf prices in 9 of 16 regions)",
  placeName: "Chile (ODEPA shelf prices)",
  status: "live",
  paramNotes: {
    item:
      "CL: an everyday food in English or Spanish ('milk', 'eggs', 'bread', 'marraqueta', 'tomato', 'potato', 'chicken', 'leche', 'huevo', 'palta'). ODEPA names products in Spanish with a unit, " +
      "so the answer names the exact product and unit and lists related ones. The 150 products found at the most monitored points are held.",
    region: "CL: one of the 9 monitored regions ('Metropolitana', 'Valparaiso', 'Biobio', 'Maule', 'Nuble', 'Coquimbo', 'La Araucania', 'Los Lagos', 'Arica y Parinacota'); leave out for the figure across all of them. A region needs 5 or more monitored points for a product.",
  },
  examples: [
    { params: { country: "CL", item: "milk" } },
    { params: { country: "CL", item: "eggs", region: "Metropolitana" }, smoke: false },
  ],
  method:
    "Chile (shop prices): ODEPA's Precios al Consumidor, collected daily into our price library; an answer is the median and range across monitored points (a sector and shop type) of each point's newest weekly average price for a product and unit over the last 4 weeks, in pesos. " +
    "Posted shelf prices recorded by ODEPA staff, not receipts; n counts monitored points, not shops or sales.",
  handle: (p, ctx) => odepaPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: odepaHarvest,
  historyKey: (p) => odepaHistoryKey({ item: str(p.item), region: str(p.region) }),
});
