// Manifest: Finland medicine prices (Kela list of prices notified for interchangeable medicinal products). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, kelaHarvest, kelaHistoryKey, kelaMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["FI"],
  countryHelp: "FI = Finland (Kela quarterly list of notified sales prices of interchangeable medicines, EUR incl. VAT)",
  placeName: "Finland",
  status: "live",
  paramNotes: { medicine: "FI: active substance or brand, first word used ('paracetamol' or Finnish 'parasetamoli', 'ibuprofen', 'atorvastatin', 'burana'). Needs 5+ interchangeable packs under that name. Interchangeable medicines only; notified prices incl. VAT, not what patients paid." },
  examples: [
    { params: { country: "FI", medicine: "paracetamol" } },
    { params: { country: "FI", medicine: "atorvastatin" }, smoke: false },
  ],
  method:
    "Finland (medicines): Kela's quarterly list of prices notified for interchangeable medicinal products (newest quarter) is collected once a day into our price library; answers are the median and range of the notified sales price per pack (EUR, incl. VAT) over all packs under an active substance or brand name. Posted prices, not market transactions.",
  handle: (p, ctx) => kelaMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: kelaHarvest,
  historyKey: (p) => kelaHistoryKey({ medicine: str(p.medicine) }),
});
