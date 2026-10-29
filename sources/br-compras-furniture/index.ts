// Manifest: Brazilian public-purchase unit prices of office and school furniture (Compras.gov.br price research). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { brFurniture, INFO } from "./source";
import { purchaseFor } from "../br-pncp-contracts/source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["BR"],
  countryHelp: "BR = Brazil (unit prices of furniture in public purchases, Compras.gov.br)",
  placeName: "Brazil (furniture bought by public bodies)",
  status: "live",
  serves: (p) => purchaseFor(String(p.what ?? "")) === null,
  paramNotes: {
    what: "BR: office or school furniture in plain words ('filing cabinet', 'office chair', 'desk', 'school desk', 'whiteboard', 'safe', 'armchair'; Portuguese words such as 'cadeira' also work). Other goods are not covered. The figure is a UNIT price.",
    cpv: "BR: optional Compras.gov.br product-family code as 'pdm:310' instead of a word.",
    buyer_area: "BR: two-letter state code of the buying body ('SP', 'RJ', 'DF').",
    months: "BR: 1 to 60 months of purchases, by purchase date (default 24).",
  },
  examples: [
    { params: { country: "BR", what: "filing cabinet", buyer_area: "SP" } },
    { params: { country: "BR", what: "office chair" }, smoke: false },
  ],
  method:
    "Brazilian public-purchase awards from Compras.gov.br price research (federal catalogue furniture families), newest 24 months by default; median and 10th–90th percentile of the unit price in reais. Public purchase prices, not shop prices; suppliers are never named.",
  handle: (p, ctx) => brFurniture({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), months: num(p.months) ?? 24, baseUrl: ctx.baseUrl }),
});
