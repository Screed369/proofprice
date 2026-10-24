// OFFLINE (Repairer 2026-10-24): ftp.halmed.hr times out at TCP connect from GitHub Actions and Vercel (cloud IP block), so no harvest ever succeeded and every HR answer would be 502.
// To bring it back: rename this file to index.ts once a probe or harvest from GitHub reaches the xlsx (curl exit 0).
// Manifest: Croatia medicine prices (HALMED maximum permitted wholesale prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, hrHarvest, hrHistoryKey, hrMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["HR"],
  countryHelp: "HR = Croatia (HALMED list of highest permitted wholesale prices of medicines, euro per pack)",
  placeName: "Croatia",
  status: "live",
  paramNotes: { medicine: "HR: active substance or brand, English or Croatian spelling, first word used ('omeprazole', 'paracetamol', 'metformin', 'Lipitor'). Needs 5+ priced packs. Highest permitted WHOLESALE price per pack, not the pharmacy or patient price." },
  examples: [
    { params: { country: "HR", medicine: "paracetamol" } },
    { params: { country: "HR", medicine: "omeprazole" }, smoke: false },
  ],
  method:
    "Croatia (medicines): HALMED's summary list of published highest permitted wholesale prices is collected once a day into our price library; answers are the median and range of the euro price per pack over all packs in force under an active substance or brand name. Posted ceilings for wholesale, not market transactions.",
  handle: (p, ctx) => hrMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: hrHarvest,
  historyKey: (p) => hrHistoryKey({ medicine: str(p.medicine) }),
});
