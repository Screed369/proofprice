// Manifest: Maricopa County, Arizona home sales from the County Assessor's sales affidavits. Logic lives in ./source.ts.
// Shares the "home-sales" country US with us-dc-home-sales and us-home-sales. This folder name sorts BEFORE both on purpose: the registry takes the
// first source whose serves() says yes, and us-home-sales says yes to every request that is not Washington, DC; only an Arizona request comes here.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, isMaricopaRequest, maricopaHarvest, maricopaHistoryKey, maricopaHomeSales, TYPES } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City, Cook County IL, Washington DC and Maricopa County AZ (Phoenix area) only; not nationwide",
  placeName: "Maricopa County, Arizona (Phoenix area)",
  status: "live",
  serves: (p) => isMaricopaRequest(p),
  paramNotes: {
    town: "US (Maricopa County, AZ): a city such as 'Phoenix', 'Scottsdale', 'Mesa', 'Tempe', 'Chandler' or 'Gilbert' (add ', AZ' if the name exists elsewhere); leave out for the whole county.",
    postcode: "US (Maricopa County, AZ): a 5-digit Arizona ZIP code (85xxx) with enough sales; 12 or 24 month windows only.",
    property_type: "US (Maricopa County, AZ): any (default), house (single-family) or condo (condominium and townhouse).",
    months: "US (Maricopa County, AZ): rounded to the nearest of 3, 6, 12 or 24 (ZIP codes: 12 or 24).",
  },
  paramValues: { property_type: TYPES.filter((t) => t !== "any") },
  examples: [
    { params: { country: "US", town: "Phoenix, AZ", property_type: "house" } },
    { params: { country: "US", state: "AZ" }, smoke: false },
  ],
  method:
    "US (Maricopa County, Arizona): the County Assessor's recorded sales affidavits are collected once a day into our price library; answers are the median and 10th–90th percentile of the sale price of single-family houses and condos over a rolling 3 to 24 months, by city or ZIP. Served free of charge (the publisher states no reuse licence).",
  handle: (p, ctx) =>
    maricopaHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: maricopaHarvest,
  historyKey: (p) => maricopaHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months) }),
});
