// Manifest: Quebec public contract prices (SEAO award notices, Données Québec). Logic lives in ./source.ts.
// Shares CA with ca-canadabuys-contracts: this source answers buyer_area=Quebec, that one everything else (declared serves() in both).
import { defineSource, str } from "../../lib/plugin";
import { INFO, isQuebecArea, qcContracts, qcContractsHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CA"],
  countryHelp: "CA = Canada (buyer_area=Quebec here: SEAO award notices of Quebec public buyers; federal contracts come from CanadaBuys)",
  placeName: "Quebec (public contracts, SEAO)",
  status: "live",
  serves: (p) => isQuebecArea(p.buyer_area),
  paramNotes: {
    what: "Quebec: a common purchase in plain words, in French or English ('laptops', 'ordinateurs portables', 'catering', 'road resurfacing', 'building cleaning').",
    cpv: "Quebec: not used.",
    buyer_area: "Quebec: write Quebec to get Quebec public buyers (ministries, school service centres, cities, municipalities); all of Quebec is summarised together.",
    months: "Quebec: not used; each figure covers awards dated in the newest 12 months.",
  },
  examples: [
    { params: { country: "CA", buyer_area: "Quebec", what: "laptops" } },
    { params: { country: "CA", buyer_area: "Quebec", what: "road resurfacing" }, smoke: false },
  ],
  method:
    "Quebec public contract award notices from SEAO (Secrétariat du Conseil du trésor, Données Québec, CC BY 4.0), awards dated in the newest 12 months, recognised by words in the French title or the UNSPSC code. Median and 10th–90th percentile of the awarded amount in CAD, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) => qcContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => qcContractsHarvest(),
  noHistory: "Quebec: the contract figures cover the newest 12 months of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
