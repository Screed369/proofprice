// Manifest: Brazil (Recife city) home sales from the city's ITBI open data. Logic lives in ./source.ts.
// Folder name sorts AFTER br-itbi-fortaleza and BEFORE br-itbi-rio and br-poa-itbi on purpose: the registry takes the first source whose
// serves() says yes, so Recife places are tried before Rio; everything else falls through to br-poa-itbi (the catch-all).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, TYPES, recifeHarvest, recifeHistoryKey, recifeHomeSales, servesRecife } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BR"],
  countryHelp: "BR = Brazil (Recife city: ITBI assessed value, not a verified price paid; Fortaleza, Rio de Janeiro and Porto Alegre have their own sources)",
  placeName: "Recife, Brazil",
  status: "live",
  paramNotes: {
    town: "BR (Recife): a Recife neighbourhood (bairro) such as 'Boa Viagem', 'Pina' or 'Casa Forte', or 'Recife' for the whole city. Other Brazilian cities are not available here.",
    postcode: "BR (Recife): a CEP starting 50, 51 or 52 routes here, but figures are by neighbourhood; give the neighbourhood as town.",
    property_type: "BR (Recife): any, apartment or house.",
    months: "BR (Recife): rounded to the nearest of 3, 6, 12 or 24.",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "BR", town: "Boa Viagem", property_type: "apartment" } },
    { params: { country: "BR", town: "Recife" }, smoke: false },
  ],
  method:
    "Brazil (Recife): the city's ITBI property-transfer tax records are collected once a day into our price library; answers are rolling 3 to 24 month windows by neighbourhood for apartments and houses. The figure is the municipal assessed value the tax is charged on, not a verified price paid.",
  serves: (p) => servesRecife(str(p.town), str(p.postcode)),
  handle: (p, ctx) => recifeHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: recifeHarvest,
  historyKey: (p) => recifeHistoryKey({ town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
});
