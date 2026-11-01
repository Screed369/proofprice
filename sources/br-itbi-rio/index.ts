// Manifest: Brazil (Rio de Janeiro city) home sales from the city's ITBI open data. Logic lives in ./source.ts.
// Folder name sorts BEFORE br-poa-itbi on purpose: the registry takes the first source whose serves() says yes, so Rio places are tried first;
// everything else in Brazil falls through to br-poa-itbi, whose serves() must be a catch-all (platform task).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, TYPES, rioHarvest, rioHistoryKey, rioHomeSales, servesRio } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BR"],
  countryHelp: "BR = Brazil (Rio de Janeiro city: ITBI property-transfer tax declared values, not a verified price paid; Porto Alegre has its own source)",
  placeName: "Rio de Janeiro, Brazil",
  status: "live",
  paramNotes: {
    town: "BR (Rio de Janeiro): a Rio de Janeiro neighbourhood (bairro) such as 'Copacabana', 'Ipanema', 'Tijuca' or 'Barra da Tijuca', or 'Rio de Janeiro' for the whole city. Other Brazilian cities are not available here.",
    postcode: "BR (Rio de Janeiro): a CEP starting 20 to 23 routes here, but figures are by neighbourhood; give the neighbourhood as town.",
    property_type: "BR (Rio de Janeiro): any, apartment or house.",
    months: "BR (Rio de Janeiro): rounded to the nearest of 3, 6, 12 or 24.",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "BR", town: "Copacabana", property_type: "apartment" } },
    { params: { country: "BR", town: "Rio de Janeiro" }, smoke: false },
  ],
  method:
    "Brazil (Rio de Janeiro): the city's ITBI property-transfer tax records are collected once a day into our price library; answers are rolling 3 to 24 month windows by neighbourhood for apartments and houses. The figure is the transaction value declared for the tax, not a verified price paid.",
  serves: (p) => servesRio(str(p.town), str(p.postcode)),
  handle: (p, ctx) => rioHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: rioHarvest,
  historyKey: (p) => rioHistoryKey({ town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
});
