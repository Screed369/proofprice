// Manifest: Poland medicine prices (Ministry of Health list of reimbursed medicines, maximum retail prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, plHarvest, plHistoryKey, plMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["PL"],
  countryHelp: "PL = Poland (Ministry of Health list of reimbursed pharmacy medicines: official maximum retail price per pack, PLN incl. VAT)",
  placeName: "Poland",
  status: "live",
  paramNotes: { medicine: "PL: active substance ('metformin', 'atorvastatin', 'rosuvastatin') or Polish brand name, first word. Needs 5+ packs on the list." },
  examples: [
    { params: { country: "PL", medicine: "atorvastatin" } },
    { params: { country: "PL", medicine: "metformin" }, smoke: false },
  ],
  method:
    "Poland (medicines): the Ministry of Health list of reimbursed pharmacy medicines is collected once a day into our price library; answers are the median and range of the official maximum retail price per pack over all packs of an active substance or brand name. Regulated maximum prices, not market transactions.",
  handle: (p, ctx) => plMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: plHarvest,
  historyKey: (p) => plHistoryKey({ medicine: str(p.medicine) }),
});
