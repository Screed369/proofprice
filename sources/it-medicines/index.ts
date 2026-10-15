// Manifest: Italy medicine prices (AIFA transparency list). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, itHarvest, itHistoryKey, itMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["IT"],
  countryHelp: "IT = Italy (AIFA transparency list: public prices of reimbursable off-patent class A medicines)",
  placeName: "Italy",
  status: "live",
  paramNotes: { medicine: "IT: Italian active-substance or brand name, first word used ('paracetamolo', 'amoxicillina', 'glucobay'). Needs 5+ packs under that name. Off-patent reimbursable (class A) medicines only." },
  examples: [
    { params: { country: "IT", medicine: "paracetamolo" } },
    { params: { country: "IT", medicine: "amoxicillina" }, smoke: false },
  ],
  method:
    "Italy (medicines): AIFA's monthly transparency list of reimbursable off-patent medicines is collected once a day into our price library; answers are the median and range of the public shelf price per pack over all packs under a substance or brand name. Posted prices, not market transactions.",
  handle: (p, ctx) => itMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: itHarvest,
  historyKey: (p) => itHistoryKey({ medicine: str(p.medicine) }),
});
