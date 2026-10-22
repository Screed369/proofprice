// Manifest: Canadian federal contract prices (CanadaBuys award notices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { caContracts, caContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CA"],
  countryHelp: "CA = Canada (federal award notices on CanadaBuys)",
  placeName: "Canada (federal contracts, CanadaBuys)",
  status: "live",
  paramNotes: {
    what: "CA: a common purchase in plain words ('translation services', 'legal services', 'catering', 'consultancy', 'IT services', 'laptops', 'security guards'). Recognised from the words in the notice title; other wording is not searched.",
    cpv: "CA: not used.",
    buyer_area: "CA: not used; all federal buyers are summarised together.",
    months: "CA: not used; each figure covers the newest 24 months of awards.",
  },
  examples: [
    { params: { country: "CA", what: "translation services" } },
    { params: { country: "CA", what: "legal services" }, smoke: false },
  ],
  method:
    "Canadian federal contract award notices from CanadaBuys (Open Government Licence - Canada), newest 24 months, recognised by words in the English title. Median and 10th–90th percentile of the awarded contract amount in CAD, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) => caContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => caContractsHarvest(),
  noHistory: "Canada: the contract figures cover the newest 24 months of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
