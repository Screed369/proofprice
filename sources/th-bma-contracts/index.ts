// Manifest: Bangkok (Thailand) public contract prices (Bangkok Metropolitan Administration open procurement data, OCDS). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { thContracts, thContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["TH"],
  countryHelp: "TH = Thailand, Bangkok city administration only (Bangkok Metropolitan Administration contracts)",
  placeName: "Thailand (Bangkok city contracts)",
  status: "live",
  paramNotes: {
    what: "TH: a common purchase in plain words ('school meals', 'building cleaning', 'school cleaning', 'security guard services', 'laptops'). Recognised from Thai words in the contract title; other purchases are not searched.",
    cpv: "TH: not used.",
    buyer_area: "TH: not used; all Bangkok Metropolitan Administration buyers are summarised together.",
    months: "TH: not used; each figure covers the newest 24 months of contracts.",
  },
  examples: [
    { params: { country: "TH", what: "school meals" } },
    { params: { country: "TH", what: "building cleaning" }, smoke: false },
  ],
  method:
    "Bangkok Metropolitan Administration (Thailand) active contracts from its OCDS open data (Open Contracting Partnership, CC BY 4.0), newest 24 months by contract start date, recognised by Thai keywords in the contract title. Median and 10th–90th percentile of the contract value in THB, from the daily copy in our price library. Totals per contract, not unit prices; Bangkok city administration only; suppliers are never named.",
  handle: (p, ctx) => thContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => thContractsHarvest(),
  noHistory: "Thailand: the contract figures cover the newest 24 months of contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
