// Manifest: France medicine prices (public medicines database). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, frHarvest, frHistoryKey, frMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["FR"],
  countryHelp: "FR = France (public medicines database: legally fixed prices of reimbursable medicines)",
  placeName: "France",
  status: "live",
  paramNotes: { medicine: "FR: brand or active substance, first word used ('doliprane', 'paracetamol', 'amoxicilline'). Needs 5+ priced packs under that name." },
  examples: [
    { params: { country: "FR", medicine: "doliprane" } },
    { params: { country: "FR", medicine: "paracetamol" }, smoke: false },
  ],
  method:
    "France (medicines): the public medicines database (ANSM, HAS, Assurance Maladie) is collected once a day into our price library; answers are the median and range of the legally fixed price per box over all reimbursable packs under a medicine name. Regulated prices, not market transactions.",
  handle: (p, ctx) => frMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: frHarvest,
  historyKey: (p) => frHistoryKey({ medicine: str(p.medicine) }),
});
