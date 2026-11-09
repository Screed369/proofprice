// Manifest: Taiwan medicine prices (NHIA National Health Insurance drug payment prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, twHarvest, twHistoryKey, twMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (NHIA National Health Insurance drug payment prices in New Taiwan dollars)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: { medicine: "TW: the active ingredient in English ('amlodipine', 'metformin', 'acetaminophen') or an ATC code ('C08CA01'); first word used. Not brand names. Needs 5+ listed items. Official payment price per tablet, capsule or other listed item, not what a patient paid." },
  examples: [
    { params: { country: "TW", medicine: "amlodipine" } },
    { params: { country: "TW", medicine: "metformin" }, smoke: false },
  ],
  method:
    "Taiwan (medicines): the National Health Insurance Administration's drug item file (all reimbursed drugs with their current payment price) is collected once a day into our price library; answers are the median and range of the official New Taiwan dollar price per item over all listed drug items with a given active ingredient. Posted reimbursement prices, not market transactions.",
  handle: (p, ctx) => twMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: twHarvest,
  historyKey: (p) => twHistoryKey({ medicine: str(p.medicine) }),
});
