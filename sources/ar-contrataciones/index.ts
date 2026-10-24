// Manifest: Argentine public contract award values (COMPR.AR, datos.gob.ar). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { arContracts, arHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["AR"],
  countryHelp: "AR = Argentina (national public bodies, COMPR.AR)",
  placeName: "Argentina (public contracts, COMPR.AR)",
  status: "live",
  paramNotes: {
    what: "AR: 'all' or a COMPR.AR product group (rubro), in Spanish or English for the common ones ('informatica' or 'computers', 'alimentos' or 'food', 'limpieza' or 'cleaning'). An unknown word lists the groups.",
    cpv: "AR: not used; COMPR.AR has its own product groups, put the group in what.",
    buyer_area: "AR: not used; all national public bodies are summarised together.",
    months: "AR: not used; each figure covers awards dated in the newest 12 months.",
  },
  examples: [
    { params: { country: "AR", what: "all" } },
    { params: { country: "AR", what: "computers" }, smoke: false },
  ],
  method:
    "Argentine public contract awards from COMPR.AR (Oficina Nacional de Contrataciones, datos.gob.ar, CC BY 4.0), newest 12 months by award date, by product group. Median and 10th–90th percentile of the awarded value in pesos, from the daily copy in our price library. Totals per award, not unit prices; suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "AR",
  handle: (p, ctx) => arContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => arHarvest(),
  noHistory:
    "Argentina: the contract figures cover the newest 12 months of awards in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
