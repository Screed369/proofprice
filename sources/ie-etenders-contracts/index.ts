// Manifest: Irish public contract prices (OGP eTenders open data, CC BY 4.0). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { ieContracts, ieContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["IE"],
  countryHelp: "IE = Ireland (public contract awards, eTenders)",
  placeName: "Ireland (public contracts, eTenders)",
  status: "live",
  paramNotes: {
    what: "IE: a common purchase in plain words ('catering', 'school meals', 'software', 'consultancy', 'legal services', 'cars'; a purchase with fewer than 5 Irish awards in the window has no figure). Recognised from the award's main CPV product code.",
    cpv: "IE: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 4523); used instead of the words in what.",
    buyer_area: "IE: not used; all Irish public buyers are summarised together.",
    months: "IE: not used; each figure covers the newest 24 months of awards.",
  },
  examples: [
    { params: { country: "IE", what: "catering" } },
    { params: { country: "IE", what: "school meals" }, smoke: false },
  ],
  method:
    "Irish public contract awards from the OGP eTenders open data file (CC BY 4.0), newest 24 months by award date, recognised by main CPV product code. Median and 10th–90th percentile of the awarded value in EUR (ex VAT), from the daily copy in our price library. Frameworks and dynamic purchasing systems excluded. Totals per contract, not unit prices; buyers and suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "IE",
  handle: (p, ctx) => ieContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => ieContractsHarvest(),
  noHistory:
    "Ireland: the contract figures cover the newest 24 months of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
