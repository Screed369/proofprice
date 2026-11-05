// Manifest: Canadian federal contract values (Treasury Board proactive disclosure, OGL-Canada). Logic lives in ./source.ts.
// Shares CA with ca-canadabuys-contracts (CanadaBuys award notices), ca-qc-contracts and ca-ab-sole-source: this source answers
// buyer_area=federal (and the other words isFederalArea accepts); CanadaBuys keeps every request without that word. Folder order puts
// this folder before ca-canadabuys-contracts, whose serves() still says yes to "federal", so this source is picked first.
import { defineSource, str } from "../../lib/plugin";
import { caContractsHarvest, caFederalContracts, INFO, isFederalArea } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CA"],
  countryHelp: "CA = Canada (buyer_area=federal here: federal contract values over CA$10,000 from the Treasury Board proactive disclosure; without buyer_area, federal award notices from CanadaBuys)",
  placeName: "Canada (federal contracts over CA$10,000, proactive disclosure)",
  status: "live",
  serves: (p) => isFederalArea(p.buyer_area),
  paramNotes: {
    what: "CA with buyer_area=federal: the government's own kind of purchase ('translation services', 'management consulting', 'security services'), or all, goods, services, construction. Words are matched against the description of the spending; a kind with fewer than 5 contracts has no figure.",
    cpv: "CA federal: not used.",
    buyer_area: "CA: federal = the Treasury Board proactive disclosure of federal contracts over CA$10,000 (this source). Quebec = SEAO, Alberta = sole-source list; leave it out for CanadaBuys award notices.",
    months: "CA federal: not used; the figure covers the newest 24 months of contract dates in the file.",
  },
  examples: [
    { params: { country: "CA", buyer_area: "federal", what: "translation services" } },
    { params: { country: "CA", buyer_area: "federal", what: "all" }, smoke: false },
  ],
  method:
    "Federal contracts over CA$10,000 published under the Treasury Board proactive disclosure (open.canada.ca, Open Government Licence - Canada), newest 24 months of contract dates, grouped by the government's own description of the spending. Median and 10th–90th percentile of the contract value in CAD (original value plus amendments), from the daily copy in our price library. Contracted totals, not unit prices; suppliers and buyers are never named.",
  handle: (p, ctx) => caFederalContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => caContractsHarvest(),
  noHistory:
    "Canadian federal contract values: the file is refreshed quarterly and covers a rolling 24 months; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
