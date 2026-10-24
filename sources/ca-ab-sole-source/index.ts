// Manifest: Alberta sole-source service contracts (Open Alberta). Logic lives in ./source.ts.
// Shares CA with ca-canadabuys-contracts: this source answers buyer_area=Alberta, that one everything else (declared serves() in both).
import { defineSource, str } from "../../lib/plugin";
import { abSoleSource, abSoleSourceHarvest, INFO, isAlbertaArea } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CA"],
  countryHelp: "CA = Canada (buyer_area=Alberta here: Alberta government sole-source service contracts; federal contracts come from CanadaBuys, Quebec from SEAO)",
  placeName: "Alberta (sole-source service contracts)",
  status: "live",
  serves: (p) => isAlbertaArea(p.buyer_area),
  paramNotes: {
    what: "Alberta: what=all for every sole-source service contract, or a common service in plain words ('consultancy', 'legal services', 'IT services', 'software', 'translation services').",
    cpv: "Alberta: not used.",
    buyer_area: "Alberta: write Alberta to get Alberta government departments; these are contracts awarded without competition.",
    months: "Alberta: not used; each figure covers contracts starting in the newest 24 months.",
  },
  examples: [
    { params: { country: "CA", buyer_area: "Alberta", what: "all" } },
    { params: { country: "CA", buyer_area: "Alberta", what: "consultancy" }, smoke: false },
  ],
  method:
    "Alberta government sole-source service contracts of CA$10,000 or more (Open Alberta, Open Government Licence - Alberta), starting in the newest 24 months. Median and 10th–90th percentile of the contract value in CAD, from the daily copy in our price library. Totals per contract awarded without competition, not unit prices; suppliers are never named.",
  handle: (p, ctx) => abSoleSource({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => abSoleSourceHarvest(),
  noHistory: "Alberta: the contract figures cover the newest 24 months in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
