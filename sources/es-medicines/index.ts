// Manifest: Spain medicine prices (Ministerio de Sanidad Nomenclator). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, esHarvest, esHistoryKey, esMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["ES"],
  countryHelp: "ES = Spain (Ministerio de Sanidad Nomenclator: legally fixed public prices of medicines billed to the national health service)",
  placeName: "Spain",
  status: "live",
  paramNotes: { medicine: "ES: Spanish active-ingredient or brand name, first word used ('paracetamol', 'ibuprofeno', 'omeprazol', 'dolocatil'). Needs 5+ packs on sale under that name." },
  examples: [
    { params: { country: "ES", medicine: "paracetamol" } },
    { params: { country: "ES", medicine: "omeprazol" }, smoke: false },
  ],
  method:
    "Spain (medicines): the Ministerio de Sanidad Nomenclator of medicines billed to the national health service is collected once a day into our price library; answers are the median and range of the legally fixed public price per pack over all packs on sale under an ingredient or brand name. Regulated prices, not market transactions.",
  handle: (p, ctx) => esMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: esHarvest,
  historyKey: (p) => esHistoryKey({ medicine: str(p.medicine) }),
});
