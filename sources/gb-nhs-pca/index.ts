// Manifest: England medicine prices (NHSBSA Prescription Cost Analysis, NHS reimbursement price). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, gbMedicine } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["GB"],
  countryHelp: "GB = England (NHS Prescription Cost Analysis: the basic price the NHS reimburses for the drug, per tablet/capsule/ml, not a patient price; England only)",
  placeName: "England (NHS)",
  status: "live",
  paramNotes: {
    medicine:
      "GB: generic or brand name, optionally with strength and form ('omeprazole', 'atorvastatin 20mg', 'Lipitor', 'paracetamol tablets'). " +
      "NHS names follow the British National Formulary (the common American names are mapped). Returns the NHS net ingredient cost per unit and per 28-unit supply.",
  },
  examples: [
    { params: { country: "GB", medicine: "omeprazole" } },
    { params: { country: "GB", medicine: "atorvastatin" }, smoke: false },
    { params: { country: "GB", medicine: "atorvastatin 20mg" }, smoke: false },
  ],
  method:
    "England (medicines): NHSBSA's monthly Prescription Cost Analysis (open data portal) is queried live for the newest month: Net Ingredient Cost (the Drug Tariff basic price of what was dispensed) divided by the quantity, per tablet, capsule or ml. A reimbursement price for the drug, before discounts, fees and patient charges; not a shop price.",
  handle: (p, ctx) => gbMedicine({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
