// Manifest: Czech public contract values (Registr smluv monthly dumps, daily copy in the price library). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { czContracts, czContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["CZ"],
  countryHelp: "CZ = Czech Republic (public contracts, Registr smluv)",
  placeName: "Czech Republic (public contracts, Registr smluv)",
  status: "live",
  paramNotes: {
    what: "CZ: a common purchase in plain words ('laptops', 'waste collection', 'office cleaning', 'electricity', 'legal services', 'security guards'). Recognised from Czech words in the contract subject, so a match is approximate.",
    cpv: "CZ: not used; the register has no product codes.",
    buyer_area: "CZ: not used; all Czech public bodies are summarised together.",
    months: "CZ: not used; each figure covers contracts published in the newest weeks (the answer gives the dates).",
  },
  examples: [
    { params: { country: "CZ", what: "waste collection" } },
    { params: { country: "CZ", what: "electricity" }, smoke: false },
  ],
  method:
    "Contracts published in the Czech Registr smluv (monthly XML dumps), newest one to two months by publication date, purchases recognised from Czech words in the contract subject. Median and 10th–90th percentile of the contract value in CZK excluding VAT, from the daily copy in our price library. Totals per contract, not unit prices; parties and subjects are never kept.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "CZ",
  handle: (p, ctx) => czContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => czContractsHarvest(),
  noHistory:
    "Czech Republic: the contract figures cover contracts published in the newest weeks in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
