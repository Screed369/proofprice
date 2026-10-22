// Manifest: Colombian public contract prices (SECOP II, datos.gov.co). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { coContracts, coContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CO"],
  countryHelp: "CO = Colombia (signed public contracts in SECOP II)",
  placeName: "Colombia (public contracts, SECOP II)",
  status: "live",
  paramNotes: {
    what: "CO: a common purchase in plain words ('catering', 'security guard services', 'office cleaning', 'laptops', 'ambulances', 'printers', 'photocopiers'). Recognised from the Spanish words in the contract description; other wording is not searched.",
    cpv: "CO: not used.",
    buyer_area: "CO: not used; all public buyers are summarised together.",
    months: "CO: not used; each figure covers the newest 12 months of signed contracts.",
  },
  examples: [
    { params: { country: "CO", what: "security guard services" } },
    { params: { country: "CO", what: "laptops" }, smoke: false },
  ],
  method:
    "Colombian signed public contracts from SECOP II (Colombia Compra Eficiente, datos.gov.co, CC BY-SA 4.0), newest 12 months, recognised by Spanish words in the contract description. Median and 10th–90th percentile of the contract value in COP, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) => coContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => coContractsHarvest(),
  noHistory: "Colombia: the contract figures cover the newest 12 months of signed contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
