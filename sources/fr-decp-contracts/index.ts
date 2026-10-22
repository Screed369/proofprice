// Manifest: French public contract prices (DECP consolidated essential data, data.gouv.fr). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { frContracts, frContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["FR"],
  countryHelp: "FR = France (awarded public contracts, DECP)",
  placeName: "France (public contracts, DECP)",
  status: "live",
  paramNotes: {
    what: "FR: a common purchase in plain words, in French or English ('ordinateurs portables', 'laptops', 'restauration scolaire', 'road resurfacing', 'office cleaning', 'ambulances'). Recognised from the contract's CPV product code.",
    cpv: "FR: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "FR: not used; all French public buyers are summarised together.",
    months: "FR: not used; each figure covers contracts notified in the newest 12 months.",
  },
  examples: [
    { params: { country: "FR", what: "laptops" } },
    { params: { country: "FR", what: "restauration scolaire" }, smoke: false },
  ],
  method:
    "French awarded public contracts from the DECP consolidated files (data.gouv.fr, Licence Ouverte 2.0), newest 12 months by notification date, recognised by CPV product code. Median and 10th–90th percentile of the award amount in EUR, from the daily copy in our price library. Totals per contract, not unit prices; framework-agreement ceilings are left out; suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "FR",
  handle: (p, ctx) => frContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => frContractsHarvest(),
  noHistory:
    "France: the contract figures cover the newest 12 months of notified contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
