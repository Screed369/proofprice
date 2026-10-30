// Manifest: Czech Republic medicine prices (SUKL Seznam cen a uhrad LP). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, czHarvest, czHistoryKey, czMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["CZ"],
  countryHelp: "CZ = Czech Republic (SUKL list of reimbursed medicines: legally fixed maximum consumer price per pack, CZK incl. VAT)",
  placeName: "Czech Republic",
  status: "live",
  paramNotes: { medicine: "CZ: Czech brand name, first word ('metformin', 'atorvastatin', 'ventolin') or an ATC code ('A10BA02' metformin, 'C10AA05' atorvastatin, or a group like 'C10AA'). No active-substance search. Needs 5+ packs on the list." },
  examples: [
    { params: { country: "CZ", medicine: "C10AA05" } },
    { params: { country: "CZ", medicine: "metformin" }, smoke: false },
  ],
  method:
    "Czech Republic (medicines): the SUKL list of reimbursed medicines is collected once a day into our price library; answers are the median and range of the legally fixed maximum consumer price per pack over all packs under a brand name or ATC code. Regulated maximum prices, not market transactions.",
  handle: (p, ctx) => czMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: czHarvest,
  historyKey: (p) => czHistoryKey({ medicine: str(p.medicine) }),
});
