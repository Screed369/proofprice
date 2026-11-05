// Manifest: Brazil medicine tender award prices (Medicamentos Transparentes via Open Contracting Partnership). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, medicamentosTransparentes, medicinesHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["BR"],
  countryHelp: "BR = Brazil (unit prices that public buyers awarded in medicine tenders on the PNCP; not pharmacy prices)",
  placeName: "Brazil",
  status: "live",
  paramNotes: { medicine: "BR: Portuguese active ingredient (first match wins): 'dipirona', 'amoxicilina', 'insulina', 'ibuprofeno', 'paracetamol'; a few English names work ('aspirin', 'metformin'). Answers the most-awarded presentation (strength and form shown) per unit, with other presentations listed. Public tender award prices, not pharmacy prices." },
  examples: [
    { params: { country: "BR", medicine: "dipirona" } },
    { params: { country: "BR", medicine: "amoxicilina" }, smoke: false },
  ],
  method:
    "Brazil (medicines): the Medicamentos Transparentes file of PNCP medicine tenders (republished by the Open Contracting Partnership) is read once a day into our price library; answers are the median and range of the awarded unit price (BRL) for the most-awarded presentation of an active ingredient over the last 24 months of the file. Public tender award prices, not market transactions at pharmacies.",
  handle: (p, ctx) => medicamentosTransparentes({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: medicinesHarvest,
});
