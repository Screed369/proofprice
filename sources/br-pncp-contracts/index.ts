// Manifest: Brazilian public contract prices (PNCP, Portal Nacional de Contratacoes Publicas). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { brContracts, brContractsHarvest, INFO, purchaseFor } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["BR"],
  countryHelp: "BR = Brazil (initial public contracts published on the PNCP national procurement portal)",
  placeName: "Brazil (public contracts, PNCP)",
  status: "beta",
  paramNotes: {
    what: "BR: a common purchase in plain words, English or Portuguese ('school meals', 'merenda escolar', 'security guard services', 'cleaning services', 'laptops', 'ambulances', 'printers', 'diesel'). Recognised from Portuguese words in the contract description; other wording is not searched.",
    cpv: "BR: not used.",
    buyer_area: "BR: optional two-letter state code of the buyer (SP, RJ, MG, DF...); left out = all of Brazil. A state with fewer than 5 contracts for the purchase gets no figure.",
    months: "BR: not used; each figure covers the contracts published in the last 7 days.",
  },
  examples: [
    { params: { country: "BR", what: "security guard services" } },
    { params: { country: "BR", what: "school meals", buyer_area: "SP" }, smoke: false },
  ],
  method:
    "Brazilian initial public contracts published on the PNCP (Portal Nacional de Contratacoes Publicas) in the last 7 days, recognised by Portuguese words in the contract description. Median and 10th–90th percentile of the contract value in BRL, from the daily copy in our price library. Totals per contract, not unit prices; suppliers are never named. Served free of charge only (the PNCP licence for its API data is not clear).",
  // Brazil is shared with br-compras-furniture (furniture unit prices): this source takes the purchases it recognises, the furniture source takes everything else.
  serves: (p) => purchaseFor(String(p.what ?? "")) !== null,
  handle: (p, ctx) => brContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => brContractsHarvest(),
  noHistory: "Brazil: the contract figures cover the contracts published in the newest 7 days in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
