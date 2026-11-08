// Manifest: UK government contract prices (Contracts Finder awarded contracts). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { gbContracts, gbContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (Contracts Finder awarded contracts)",
  placeName: "the United Kingdom (Contracts Finder)",
  status: "live",
  paramNotes: {
    what: "GB: a common purchase in plain words ('software', 'IT services', 'consultancy', 'legal services', 'insurance'; very thin purchases such as laptops may have fewer than 5 awards in two weeks and return no figure). Recognised from the notice's main CPV product code.",
    cpv: "GB: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "GB: not used; all UK public buyers are summarised together.",
    months: "GB: not used; each figure covers the notices published in the newest two weeks (the answer gives the dates).",
  },
  examples: [
    { params: { country: "GB", what: "software" } },
    { params: { country: "GB", what: "consultancy" }, smoke: false },
  ],
  method:
    "UK awarded-contract notices from the Contracts Finder OCDS award feed (OGL v3.0), newest two weeks by publication date, recognised by the main CPV product code. Median and 10th–90th percentile of the awarded value in GBP, from the daily copy in our price library. Totals per contract (lot), not unit prices; buyers and suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "GB",
  handle: (p, ctx) => gbContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => gbContractsHarvest(),
  noHistory:
    "UK: the contract figures cover the newest two weeks of published award notices in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
