// Manifest: Brazil (Belo Horizonte city) home sales from the city's ITBI open data. Logic lives in ./source.ts.
// Folder name sorts BEFORE br-itbi-fortaleza, br-itbi-rio and br-poa-itbi on purpose: the registry takes the first source whose serves() says yes,
// so Belo Horizonte places are tried first; everything else falls through to the other cities, then to br-poa-itbi (the catch-all).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, TYPES, bhHarvest, bhHistoryKey, bhHomeSales, servesBh } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BR"],
  countryHelp: "BR = Brazil (Belo Horizonte city: ITBI property-transfer tax declared values, not a verified price paid; Fortaleza, Rio de Janeiro and Porto Alegre have their own sources)",
  placeName: "Belo Horizonte, Brazil",
  status: "live",
  paramNotes: {
    town: "BR (Belo Horizonte): a Belo Horizonte neighbourhood (bairro) such as 'Savassi', 'Buritis' or 'Lourdes', or 'Belo Horizonte' for the whole city. Other Brazilian cities are not available here.",
    postcode: "BR (Belo Horizonte): a CEP starting 30 or 31 routes here, but figures are by neighbourhood; give the neighbourhood as town.",
    property_type: "BR (Belo Horizonte): any, apartment or house.",
    months: "BR (Belo Horizonte): rounded to the nearest of 3, 6, 12 or 24.",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "BR", town: "Buritis", property_type: "apartment" } },
    { params: { country: "BR", town: "Belo Horizonte" }, smoke: false },
  ],
  method:
    "Brazil (Belo Horizonte): the city's ITBI property-transfer tax records are collected once a day into our price library; answers are rolling 3 to 24 month windows by neighbourhood for apartments and houses. The figure is the value declared for the tax, not a verified price paid.",
  serves: (p) => servesBh(str(p.town), str(p.postcode)),
  handle: (p, ctx) => bhHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: bhHarvest,
  historyKey: (p) => bhHistoryKey({ town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
});
