// Manifest: Estonia medicine prices (Tervisekassa reimbursement price table, reference price per pack). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, eeHarvest, eeHistoryKey, eeMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["EE"],
  countryHelp: "EE = Estonia (Tervisekassa / Estonian Health Insurance Fund reimbursement price table: reference price per pack, EUR)",
  placeName: "Estonia",
  status: "live",
  paramNotes: { medicine: "EE: active substance or brand, first word used ('omeprazole' or Estonian 'omeprasool', 'metformin', 'atorvastatin', 'ibuprofeen', 'daktarin'). Needs 5+ reimbursed packs with a reference price under that name. Reimbursed medicines only; reference prices (reimbursement ceiling per pack), not what patients paid." },
  examples: [
    { params: { country: "EE", medicine: "omeprazole" } },
    { params: { country: "EE", medicine: "metformin" }, smoke: false },
  ],
  method:
    "Estonia (medicines): Tervisekassa's quarterly price table of reimbursed medicines (newest edition) is collected once a day into our price library; answers are the median and range of the reference price per pack (EUR) over all reimbursed packs under an active substance or brand name. Posted reference prices, not market transactions.",
  handle: (p, ctx) => eeMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: eeHarvest,
  historyKey: (p) => eeHistoryKey({ medicine: str(p.medicine) }),
});
