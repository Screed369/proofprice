// Manifest: Japan medicine prices (MHLW National Health Insurance drug price list). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, jpHarvest, jpHistoryKey, jpMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["JP"],
  countryHelp: "JP = Japan (MHLW National Health Insurance drug price list: official reimbursement prices in yen)",
  placeName: "Japan",
  status: "live",
  paramNotes: { medicine: "JP: the active ingredient, in English ('paracetamol', 'amlodipine', 'metformin') or Japanese ('アムロジピン'); first word used. Not brand names. Needs 5+ listed products. Official reimbursement price per tablet, capsule, gram, millilitre or vial, not what a patient paid." },
  examples: [
    { params: { country: "JP", medicine: "amlodipine" } },
    { params: { country: "JP", medicine: "アセトアミノフェン" }, smoke: false },
  ],
  method:
    "Japan (medicines): the Ministry of Health, Labour and Welfare's National Health Insurance drug price list (oral, injection and topical files) is collected once a day into our price library; answers are the median and range of the official yen price per unit over all listed products with a given active ingredient. Posted reimbursement prices, not market transactions.",
  handle: (p, ctx) => jpMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: jpHarvest,
  historyKey: (p) => jpHistoryKey({ medicine: str(p.medicine) }),
});
