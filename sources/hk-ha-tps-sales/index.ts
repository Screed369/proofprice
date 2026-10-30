// Manifest: Hong Kong public-housing (Tenants Purchase Scheme) flat sales from the Housing Authority. Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, tpsHarvest, tpsHistoryKey, tpsHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (public rental flats sold to sitting tenants at a government discount, not market prices)",
  placeName: "Hong Kong public housing",
  status: "live",
  // Shares country HK in home-sales with hk-landreg-sales: this source answers when an estate or district is named as town.
  serves: (p) => !!str(p.town),
  paramNotes: {
    town: "HK: a public housing estate such as 'Shan King' or a district; leave out for all Tenants Purchase Scheme estates. Discounted public-flat sales, not private market prices.",
    postcode: "HK: not supported; give the estate as town.",
    property_type: "HK: flats only (any).",
    months: "HK: rounded to the nearest of 12, 24 or 60.",
  },
  examples: [{ params: { country: "HK", town: "Shan King" } }, { params: { country: "HK", town: "Shan King", months: "24" }, smoke: false }],
  method:
    "Hong Kong: the Housing Authority's Tenants Purchase Scheme sale transactions (public rental flats sold to sitting tenants at a government discount) are collected into our price library; answers are rolling 12 to 60 month windows by estate or district. Not market prices.",
  handle: (p, ctx) => tpsHomeSales({ town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: tpsHarvest,
  historyKey: (p) => tpsHistoryKey({ town: str(p.town), months: num(p.months) }),
});
