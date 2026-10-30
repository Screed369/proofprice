// Manifest: Hong Kong home sales from the Land Registry, estimated from monthly price-band counts. Logic lives in ./source.ts.
// Shares country HK in home-sales with hk-ha-tps-sales: this source answers when no town is given, the Housing Authority source when a town (estate) is given.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, hkLandRegSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (all registered residential sales by price band, estimated median; a public housing estate as town gives the Housing Authority's discounted flat sales instead)",
  placeName: "Hong Kong",
  status: "live",
  serves: (p) => !str(p.town),
  paramNotes: {
    town: "HK: leave out for the all-Hong Kong estimate from Land Registry price bands. A public housing estate or district such as 'Shan King' gives discounted Tenants Purchase Scheme sales instead (not market prices).",
    postcode: "HK: not supported.",
    property_type: "HK: all homes together (any).",
    months: "HK: 1 to 36 whole recent months that the Land Registry has published. Default 12.",
  },
  examples: [{ params: { country: "HK" } }, { params: { country: "HK", months: "3" }, smoke: false }],
  method:
    "Hong Kong: the Land Registry's monthly counts of registered residential sale and purchase agreements by HKD 1 million price band are read live; the median and the 10th-90th percentile range are estimated by spreading the deals evenly inside each band. Estimates from bands, low confidence.",
  handle: async (p, ctx) => hkLandRegSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
