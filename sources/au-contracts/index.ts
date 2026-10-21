// Manifest: Australian federal contract prices (AusTender contract notices). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { auContracts, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["AU"],
  countryHelp: "AU = Australia (AusTender federal contract notices)",
  placeName: "Australia (federal contracts, AusTender)",
  status: "live",
  paramNotes: {
    what: "AU: a word or phrase searched in the contract title and description (common purchases such as 'laptops' or 'catering' also use their UNSPSC code). Federal agencies only.",
    cpv: "AU: a UNSPSC code or prefix of 2 to 8 digits (43211503 = notebook computers, 4321 = computers), not a CPV code.",
    buyer_area: "AU: part of a federal agency's name ('Defence', 'Health', 'Parliamentary Services'); contracts have no delivery place.",
    months: "AU: not used; the newest 21 days of notices are read.",
  },
  examples: [
    { params: { country: "AU", what: "equipment" } },
    { params: { country: "AU", what: "catering", buyer_area: "Defence" }, smoke: false },
  ],
  method:
    "Australian Government contract notices from AusTender (OCDS), newest 21 days, found by UNSPSC code or words in the description. Median and 10th–90th percentile of the agreed contract value in AUD. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) =>
    auContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), months: num(p.months) ?? 24, baseUrl: ctx.baseUrl }),
});
