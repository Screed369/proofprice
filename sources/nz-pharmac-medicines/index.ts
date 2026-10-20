// Manifest: New Zealand medicine prices (PHARMAC Pharmaceutical Schedule). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nzHarvest, nzHistoryKey, nzMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (PHARMAC Pharmaceutical Schedule: list prices of subsidised community medicines, NZD)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: { medicine: "NZ: English chemical or brand name, first word used ('paracetamol', 'amoxicillin', 'panadol'). Needs 5+ subsidised packs under that name. Subsidised community medicines only; list prices, not what patients paid." },
  examples: [
    { params: { country: "NZ", medicine: "paracetamol" } },
    { params: { country: "NZ", medicine: "amoxicillin" }, smoke: false },
  ],
  method:
    "New Zealand (medicines): PHARMAC's Pharmaceutical Schedule (newest monthly edition) is collected once a day into our price library; answers are the median and range of the list price per pack over all subsidised community packs under a chemical or brand name. Posted prices, not market transactions.",
  handle: (p, ctx) => nzMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: nzHarvest,
  historyKey: (p) => nzHistoryKey({ medicine: str(p.medicine) }),
});
