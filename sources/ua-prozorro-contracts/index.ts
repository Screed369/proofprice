// Manifest: Ukrainian public contract prices (Prozorro, CC BY 4.0). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, uaContracts, uaContractsHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["UA"],
  countryHelp: "UA = Ukraine (signed public contracts, Prozorro)",
  placeName: "Ukraine (public contracts, Prozorro)",
  status: "live",
  paramNotes: {
    what: "UA: a common purchase in plain words ('electricity', 'pharmaceuticals', 'legal services', 'IT services', 'insurance' (common purchases with too few contracts in the daily sample return no_matches)). Recognised from the contract's product code (DK 021, based on the CPV).",
    cpv: "UA: a product code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "UA: not used; all Ukrainian public buyers are summarised together.",
    months: "UA: not used; each figure covers contracts signed in the newest 90 days, from a daily sample of the newest contracts.",
  },
  examples: [{ params: { country: "UA", what: "electricity" } }, { params: { country: "UA", what: "pharmaceuticals" }, smoke: false }],
  method:
    "Ukrainian public contracts signed in the newest 90 days from Prozorro (Ministry of Economy of Ukraine, data.gov.ua, CC BY 4.0), recognised by product code. Median and 10th–90th percentile of the contract value in UAH as signed (VAT included where charged), from the daily copy in our price library (a sample of the newest contracts). Totals per contract, not unit prices; suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "UA",
  handle: (p, ctx) => uaContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => uaContractsHarvest(),
  noHistory:
    "Ukraine: the contract figures cover the newest 90 days of signed contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
