// Manifest: Allegheny County, Pennsylvania (Pittsburgh area) home sales from the County Real Estate Division via WPRDC (CC0). Logic lives in ./source.ts.
// Shares the "home-sales" country US with the other US home-sales sources. This folder name sorts BEFORE us-home-sales on purpose: the registry takes
// the first source whose serves() says yes, and us-home-sales says yes to every request that is not Washington, DC.
import { defineSource, num, str } from "../../lib/plugin";
import { alleghenyHarvest, alleghenyHistoryKey, alleghenyHomeSales, INFO, isAlleghenyRequest } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City, Cook County IL, Washington DC, Maricopa County AZ and Allegheny County PA (Pittsburgh area) only; not nationwide",
  placeName: "Allegheny County, Pennsylvania (Pittsburgh area)",
  status: "live",
  serves: (p) => isAlleghenyRequest(p),
  paramNotes: {
    town: "US (Allegheny County, PA): a municipality such as 'Pittsburgh', 'Penn Hills', 'Mt Lebanon', 'Ross' or 'Bethel Park' (add ', PA' if the name exists elsewhere); leave out for the whole county.",
    postcode: "US (Allegheny County, PA): a 5-digit ZIP code (15001 to 15290) with enough sales; 12 or 24 month windows only.",
    property_type: "US (Allegheny County, PA): not available, the County table has no property type (all parcel types are mixed).",
    months: "US (Allegheny County, PA): rounded to the nearest of 3, 6, 12 or 24 (ZIP codes: 12 or 24).",
  },
  examples: [
    { params: { country: "US", town: "Pittsburgh, PA" } },
    { params: { country: "US", state: "PA" }, smoke: false },
  ],
  method:
    "US (Allegheny County, Pennsylvania): the County Real Estate Division's recorded sales (rows the County codes 'VALID SALE', $10,000 or more) are collected once a day into our price library; answers are the median and 10th–90th percentile of the sale price over a rolling 3 to 24 months, by municipality or ZIP. CC0 data.",
  handle: (p, ctx) => alleghenyHomeSales({ town: str(p.town), postcode: str(p.postcode), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: () => alleghenyHarvest(),
  historyKey: (p) => alleghenyHistoryKey({ town: str(p.town), postcode: str(p.postcode), months: num(p.months) }),
});
