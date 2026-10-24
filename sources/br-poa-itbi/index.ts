// Manifest: Brazil (Porto Alegre) home sales from the city's ITBI guides. Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, TYPES, poaHarvest, poaHistoryKey, poaHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BR"],
  countryHelp: "BR = Brazil (Porto Alegre only: ITBI property-transfer tax guides, the tax base, not a verified price paid)",
  placeName: "Porto Alegre, Brazil",
  status: "live",
  paramNotes: {
    town: "BR: a Porto Alegre neighbourhood (bairro) such as 'Moinhos de Vento' or 'Petropolis'; leave out for the whole city. Other Brazilian cities are not available.",
    postcode: "BR: not supported; give the neighbourhood as town.",
    property_type: "BR: any, apartment or house.",
    months: "BR: rounded to the nearest of 3, 6, 12 or 24.",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "BR", town: "Petropolis", property_type: "apartment" } },
    { params: { country: "BR" }, smoke: false },
  ],
  method:
    "Brazil (Porto Alegre): the city's ITBI property-transfer tax guides are collected once a day into our price library; answers are rolling 3 to 24 month windows by neighbourhood for apartments and houses. The figure is the ITBI tax base, not a verified price paid.",
  handle: (p, ctx) => poaHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: poaHarvest,
  historyKey: (p) => poaHistoryKey({ town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
});
