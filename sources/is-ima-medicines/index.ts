// Manifest: Iceland medicine prices (Icelandic Medicines Agency price list, maximum retail prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, isHarvest, isHistoryKey, isMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["IS"],
  countryHelp: "IS = Iceland (Icelandic Medicines Agency price list: official maximum retail price per pack of prescription medicines, ISK incl. VAT)",
  placeName: "Iceland",
  status: "live",
  paramNotes: { medicine: "IS: active substance ('atorvastatin', 'metformin', 'olanzapin') or Icelandic brand name, first word. Needs 5+ packs on the list." },
  examples: [
    { params: { country: "IS", medicine: "atorvastatin" } },
    { params: { country: "IS", medicine: "metformin" }, smoke: false },
  ],
  method:
    "Iceland (medicines): the Icelandic Medicines Agency price list is collected once a day into our price library; answers are the median and range of the official maximum retail price per pack over all prescription packs of an active substance or brand name. Regulated maximum prices, not market transactions.",
  handle: (p, ctx) => isMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: isHarvest,
  historyKey: (p) => isHistoryKey({ medicine: str(p.medicine) }),
});
