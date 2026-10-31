// Manifest: City of Chicago contract awards (Chicago Data Portal, Socrata). Logic lives in ./source.ts.
// Shares US with us-usaspending (federal) and us-gsa-calc (labour rates): buyer_area=Chicago comes here
// (declared serves() in both; the usaspending serves() edit is made in the same commit).
import { defineSource, str } from "../../lib/plugin";
import { isLaborRateRequest } from "../../categories/contracts/labor";
import { chicagoContracts, chicagoHarvest, INFO, isChicagoArea } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["US"],
  countryHelp: "US = United States (buyer_area=Chicago here: City of Chicago contract awards; federal contracts come from USAspending)",
  placeName: "Chicago (city contract awards)",
  status: "live",
  serves: (p) => isChicagoArea(p.buyer_area) && !isLaborRateRequest(p),
  paramNotes: {
    what: "Chicago: what=all for every city award, or a common purchase in plain words ('consultancy', 'legal services', 'IT services', 'software', 'office cleaning').",
    cpv: "Chicago: not used.",
    buyer_area: "Chicago: write Chicago to get City of Chicago awards (original awards of US$1,000 or more).",
    months: "Chicago: not used; each figure covers awards approved in the newest 24 months.",
  },
  examples: [
    { params: { country: "US", buyer_area: "Chicago", what: "all" } },
    { params: { country: "US", buyer_area: "Chicago", what: "consultancy" }, smoke: false },
  ],
  method:
    "City of Chicago contract awards (City of Chicago Data Portal), original awards of US$1,000 or more approved in the newest 24 months. Median and 10th–90th percentile of the awarded value in USD, from the daily copy in our price library. Totals per contract, not unit prices; vendors are never named.",
  handle: (p, ctx) => chicagoContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => chicagoHarvest(),
  noHistory: "Chicago: the contract figures cover the newest 24 months in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
