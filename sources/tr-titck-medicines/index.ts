// Manifest: Türkiye medicine prices (TITCK reference-based price list). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, titckHarvest, titckHistoryKey, titckMedicines } from "./source";

export default defineSource({
  info: INFO,
  category: "medicines",
  countries: ["TR"],
  countryHelp: "TR = Türkiye (TITCK reference-based list, reference ex-factory prices in EUR per pack, by brand)",
  placeName: "Türkiye",
  status: "live",
  paramNotes: { medicine: "TR: Turkish brand name, first word used ('zyprexa', 'abilify', 'zyrtec'). Needs 5+ listed packs under that brand. Reference ex-factory prices in EUR, not pharmacy prices." },
  examples: [
    { params: { country: "TR", medicine: "zyprexa" } },
  ],
  method:
    "Türkiye (medicines): TITCK's reference-based price list (newest revision) is collected once a day into our price library; answers are the median and range of the reference ex-factory price per pack (EUR) over all listed packs under a brand name. Reference prices, not market transactions.",
  handle: (p, ctx) => titckMedicines({ medicine: str(p.medicine), baseUrl: ctx.baseUrl }),
  harvest: titckHarvest,
  historyKey: (p) => titckHistoryKey({ medicine: str(p.medicine) }),
});
