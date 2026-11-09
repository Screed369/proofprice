// Manifest: City of Toronto awarded contracts (Toronto Bids, Open Data Toronto). Logic lives in ./source.ts.
// Shares CA with ca-canadabuys-contracts, ca-qc-contracts and ca-ab-sole-source. The registry picks the first source (by folder name) whose
// serves() says yes; ca-canadabuys-contracts says yes to any buyer_area not named Quebec or Alberta, so this folder is named "ca-bids-..."
// to sort before it and answers buyer_area=Toronto only (nothing outside this folder changes).
import { defineSource, str } from "../../lib/plugin";
import { INFO, isTorontoArea, torontoContracts, torontoHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CA"],
  countryHelp: "CA = Canada (buyer_area=Toronto here: contracts awarded by the City of Toronto; federal contracts come from CanadaBuys)",
  placeName: "Toronto (City of Toronto awarded contracts)",
  status: "live",
  serves: (p) => isTorontoArea(p.buyer_area),
  paramNotes: {
    what: "Toronto: 'all', or one of 'construction services', 'goods and services', 'professional services' (the City's own three categories), or a common purchase such as 'laptops' (usually too few awards for a figure).",
    cpv: "Toronto: not used.",
    buyer_area: "Toronto: write Toronto to get contracts awarded by the City of Toronto; all divisions are summarised together.",
    months: "Toronto: not used; each figure covers awards dated in the newest 24 months.",
  },
  examples: [
    { params: { country: "CA", buyer_area: "Toronto", what: "construction services" } },
    { params: { country: "CA", buyer_area: "Toronto", what: "all" }, smoke: false },
  ],
  method:
    "Contracts awarded by the City of Toronto (Toronto Bids, Open Data Toronto, Open Government Licence - Toronto), awards dated in the newest 24 months, grouped by the City's own high-level category. Median and 10th–90th percentile of the awarded amount in CAD, from the daily copy in our price library. Totals per contract, not unit prices; suppliers and buyers are never named.",
  handle: (p, ctx) => torontoContracts({ what: String(p.what), cpv: str(p.cpv), baseUrl: ctx.baseUrl }),
  harvest: () => torontoHarvest(),
  noHistory: "Toronto: the contract figures cover the newest 24 months of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
