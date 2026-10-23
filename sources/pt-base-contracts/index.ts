// Manifest: Portuguese public contract prices (Portal BASE / IMPIC, dados.gov.pt). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { ptContracts, ptContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["PT"],
  countryHelp: "PT = Portugal (public contracts, Portal BASE)",
  placeName: "Portugal (public contracts, Portal BASE)",
  status: "live",
  paramNotes: {
    what: "PT: a common purchase in plain words, in Portuguese or English ('computadores portateis', 'laptops', 'road resurfacing', 'office cleaning', 'ambulances'). Recognised from the contract's CPV product code.",
    cpv: "PT: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "PT: not used; all Portuguese public buyers are summarised together.",
    months: "PT: not used; each figure covers contracts signed in the newest 12 months.",
  },
  examples: [
    { params: { country: "PT", what: "laptops" } },
    { params: { country: "PT", what: "office cleaning" }, smoke: false },
  ],
  method:
    "Portuguese public contracts registered on Portal BASE (IMPIC, dados.gov.pt, public domain), newest 12 months by signing date, recognised by CPV product code. Median and 10th–90th percentile of the contract price in EUR, from the daily copy in our price library. Totals per contract, not unit prices; buyers and suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "PT",
  handle: (p, ctx) => ptContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => ptContractsHarvest(),
  noHistory:
    "Portugal: the contract figures cover the newest 12 months of signed contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
