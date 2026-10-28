// Manifest: Polish public contract prices (e-Zamowienia BZP result notices, UZP, CC0). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { plContracts, plContractsHarvest, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["PL"],
  countryHelp: "PL = Poland (public contracts, e-Zamowienia BZP)",
  placeName: "Poland (public contracts, e-Zamowienia)",
  status: "live",
  paramNotes: {
    what: "PL: a common purchase in plain words ('laptops', 'road resurfacing', 'office cleaning', 'school meals', 'ambulances'). Recognised from the notice's CPV product code.",
    cpv: "PL: a CPV code of 2 digits (a division) or 4 to 8 digits (read as the 4-digit group, e.g. 3021); used instead of the words in what.",
    buyer_area: "PL: not used; all Polish public buyers are summarised together.",
    months: "PL: not used; each figure covers the notices published in the newest weeks (the answer gives the dates).",
  },
  examples: [
    { params: { country: "PL", what: "road resurfacing" } },
    { params: { country: "PL", what: "office cleaning" }, smoke: false },
  ],
  method:
    "Polish public contract result notices published in the e-Zamowienia Biuletyn Zamowien Publicznych (UZP, CC0), newest three weeks by publication date, recognised by CPV product code. Median and 10th–90th percentile of the contract value in PLN, from the daily copy in our price library. Totals per contract, not unit prices; buyers and suppliers are never named.",
  serves: (p) => String(p.country ?? "").toUpperCase() === "PL",
  handle: (p, ctx) => plContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), baseUrl: ctx.baseUrl }),
  harvest: () => plContractsHarvest(),
  noHistory:
    "Poland: the contract figures cover the newest three weeks of published result notices in one window; ProofPrice keeps no daily history of them. Ask pricepaid_contract_prices (/api/v1/contracts) for the current figure.",
});
