// Manifest: South African public contract prices (National Treasury eTenders, OCDS). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { zaContracts, zaContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["ZA"],
  countryHelp: "ZA = South Africa (signed public contracts on the National Treasury eTenders portal)",
  placeName: "South Africa (public contracts, eTenders)",
  status: "live",
  paramNotes: {
    what: "ZA: a common purchase in plain words ('security guard services', 'office cleaning', 'catering', 'consultancy', 'IT services', 'legal services', 'printers', 'uniforms'). Recognised from the words in the contract description; other wording is not searched.",
    cpv: "ZA: not used.",
    buyer_area: "ZA: not used; all public buyers are summarised together.",
    months: "ZA: not used; each figure covers the newest 24 months of signed contracts.",
  },
  examples: [
    { params: { country: "ZA", what: "catering" } },
    { params: { country: "ZA", what: "office cleaning" }, smoke: false },
  ],
  method:
    "South African signed public contracts from the National Treasury eTenders OCDS data (Open Contracting Partnership, PDDL), newest 24 months, recognised by words in the contract description. Median and 10th–90th percentile of the contract value in ZAR, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) => zaContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => zaContractsHarvest(),
  noHistory: "South Africa: the contract figures cover the newest 24 months of signed contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
