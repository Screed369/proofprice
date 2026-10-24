// Manifest: German public contract prices (Bekanntmachungsservice open data, CC0). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, deContracts, deContractsHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["DE"],
  countryHelp: "DE = Germany (public contract award notices, Bekanntmachungsservice)",
  placeName: "Germany (public contracts, Bekanntmachungsservice)",
  status: "live",
  paramNotes: {
    what: "DE: a common purchase in plain words, in German or English ('laptops', 'schulessen', 'road resurfacing', 'office cleaning', 'ambulances'). Recognised from the lot's CPV product code.",
    cpv: "DE: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "DE: not used; all German public buyers are summarised together.",
    months: "DE: not used; each figure covers contracts concluded in the newest 6 months.",
  },
  examples: [
    { params: { country: "DE", what: "laptops" } },
    { params: { country: "DE", what: "office cleaning" }, smoke: false },
  ],
  method:
    "German public contract award notices (Bekanntmachungsservice, Beschaffungsamt des BMI, CC0), contracts concluded in the newest 6 months, recognised by CPV product code. Median and 10th–90th percentile of the winning tender value in EUR, from the daily copy in our price library. Totals per contract, not unit prices; framework agreements are left out; buyers and suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "DE",
  handle: (p, ctx) => deContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => deContractsHarvest(),
  noHistory:
    "Germany: the contract figures cover the newest 6 months of concluded contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
