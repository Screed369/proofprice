// Manifest: Spanish public contract awards (PLACSP, Ministerio de Hacienda). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { esContracts, esContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["ES"],
  countryHelp: "ES = Spain (awarded public contracts, PLACSP)",
  placeName: "Spain (public contracts, PLACSP)",
  status: "live",
  paramNotes: {
    what: "ES: a common purchase in plain words, in Spanish or English ('portatiles', 'laptops', 'road resurfacing', 'limpieza de oficinas', 'ambulances'). Recognised from the award's CPV product code. Only the newest one to two days of awards are summarised, so use a broad CPV division (45 = construction) for a figure.",
    cpv: "ES: a CPV code of 2 digits (a division, e.g. 45 construction) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what (what is still required, say anything such as 'works').",
    buyer_area: "ES: not used; all Spanish public buyers are summarised together.",
    months: "ES: not used; each figure covers awards dated in the newest one to two days.",
  },
  examples: [
    { params: { country: "ES", what: "construction works", cpv: "45" } },
    { params: { country: "ES", what: "office cleaning" }, smoke: false },
  ],
  method:
    "Spanish public contract awards published on PLACSP (Ministerio de Hacienda, buyers' profile feed), awards dated in the newest one to two days, recognised by CPV product code. Median and 10th–90th percentile of the awarded price in EUR without VAT, from the daily copy in our price library. Totals per contract, not unit prices; buyers and winners are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "ES",
  handle: (p, ctx) => esContracts({ what: String(p.what ?? ""), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => esContractsHarvest(),
  noHistory:
    "Spain: the contract figures cover the newest one to two days of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
