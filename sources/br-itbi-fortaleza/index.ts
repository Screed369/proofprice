// Manifest: Brazil (Fortaleza city) home sales from the city's ITBI open data. Logic lives in ./source.ts.
// Folder name sorts BEFORE br-itbi-rio and br-poa-itbi on purpose: the registry takes the first source whose serves() says yes,
// so Fortaleza places are tried first; everything else falls through to Rio, then to br-poa-itbi (the catch-all).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, TYPES, fortalezaHarvest, fortalezaHistoryKey, fortalezaHomeSales, servesFortaleza } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BR"],
  countryHelp: "BR = Brazil (Fortaleza city: ITBI property-transfer tax base, not a verified price paid; Rio de Janeiro and Porto Alegre have their own sources)",
  placeName: "Fortaleza, Brazil",
  status: "live",
  paramNotes: {
    town: "BR (Fortaleza): a Fortaleza neighbourhood (bairro) such as 'Aldeota', 'Meireles' or 'Papicu', or 'Fortaleza' for the whole city. Other Brazilian cities are not available here.",
    postcode: "BR (Fortaleza): a CEP starting 60 or 61 routes here, but figures are by neighbourhood; give the neighbourhood as town.",
    property_type: "BR (Fortaleza): any, apartment or house.",
    months: "BR (Fortaleza): rounded to the nearest of 3, 6, 12 or 24.",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "BR", town: "Aldeota", property_type: "apartment" } },
    { params: { country: "BR", town: "Fortaleza" }, smoke: false },
  ],
  method:
    "Brazil (Fortaleza): the city's ITBI property-transfer tax records are collected once a day into our price library; answers are rolling 3 to 24 month windows by neighbourhood for apartments and houses. The figure is the ITBI tax base, not a verified price paid.",
  serves: (p) => servesFortaleza(str(p.town), str(p.postcode)),
  handle: (p, ctx) => fortalezaHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: fortalezaHarvest,
  historyKey: (p) => fortalezaHistoryKey({ town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
});
