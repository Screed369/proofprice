// Manifest: Nigerian federal public contract award values (NOCOPO / Bureau of Public Procurement, OCDS via the OCP registry). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ngContracts, ngHarvest, THEMES } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["NG"],
  countryHelp: "NG = Nigeria (federal public bodies, NOCOPO)",
  placeName: "Nigeria (federal public contracts, NOCOPO)",
  status: "live",
  paramNotes: {
    what: `NG: 'all' or a purchase theme matched from the contract title: ${THEMES.map((t) => t.id).join(", ")} (common words such as 'vehicles', 'roads', 'laptops' or 'diesel' work). An unknown word lists the themes.`,
    cpv: "NG: not used; put the purchase theme in what.",
    buyer_area: "NG: not used; all federal public bodies are summarised together.",
    months: "NG: not used; each figure covers the 24 months up to the newest month with at least 20 signed contracts (late 2024).",
  },
  examples: [
    { params: { country: "NG", what: "all" } },
    { params: { country: "NG", what: "vehicles" }, smoke: false },
  ],
  method:
    "Nigerian federal contract awards from the Bureau of Public Procurement's NOCOPO portal (ODC Public Domain Dedication and Licence), republished as OCDS by the Open Contracting Partnership: active naira contracts signed in the 24 months up to the newest month with at least 20 contracts (late 2024, the portal has few newer awards), by purchase theme matched from the contract title. Median and 10th–90th percentile of the contract value, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "NG",
  handle: (p, ctx) => ngContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => ngHarvest(),
  noHistory:
    "Nigeria: the contract figures cover one fixed window of awards that ends in late 2024 (the portal records almost no newer awards); ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
