// Manifest: Sweden medicine prices (TLV Periodens vara). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, seHarvest, seHistoryKey, seMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["SE"],
  countryHelp: "SE = Sweden (TLV list of substitutable medicines: regulated pharmacy retail prices, SEK)",
  placeName: "Sweden",
  status: "live",
  paramNotes: { medicine: "SE: substance or brand name, first word used ('paracetamol', 'quetiapine', 'alvedon'); common English names are mapped to Swedish. Needs 5+ packs under that name. Substitutable medicines only; posted prices, not what patients paid." },
  examples: [
    { params: { country: "SE", medicine: "paracetamol" } },
    { params: { country: "SE", medicine: "quetiapine" }, smoke: false },
  ],
  method:
    "Sweden (medicines): TLV's 'Periodens vara' price list (newest monthly file) is collected once a day into our price library; answers are the median and range of the regulated retail price per pack over all packs under a substance or brand name. Posted prices, not market transactions.",
  handle: (p, ctx) => seMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: seHarvest,
  historyKey: (p) => seHistoryKey({ medicine: str(p.medicine) }),
});
