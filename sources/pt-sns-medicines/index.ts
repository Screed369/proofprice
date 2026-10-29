// Manifest: Portugal medicine prices (SNS Portal da Transparência, average price per pack). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ptMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["PT"],
  countryHelp: "PT = Portugal (SNS Portal da Transparência: average retail value per pack of medicines dispensed, mainland, no per-medicine detail)",
  placeName: "Portugal",
  status: "live",
  paramNotes: { medicine: "PT: only an average over all packs: medicine=all (all medicines) or medicine=generics (generic medicines). No single-medicine prices." },
  examples: [
    { params: { country: "PT", medicine: "all" } },
    { params: { country: "PT", medicine: "generics" }, smoke: false },
  ],
  method:
    "Portugal (medicines): the SNS Portal da Transparência publishes the monthly retail value and number of packs dispensed per region; we pass on the pack-weighted national average for the newest month. An average over all packs, posted retail prices, not per medicine.",
  handle: (p, ctx) => ptMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
});
