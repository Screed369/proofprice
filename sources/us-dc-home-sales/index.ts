// Manifest: Washington, DC home sales (the District's assessment records). Shares the "home-sales" country US with us-home-sales:
// this source serves Washington, DC requests and us-home-sales serves everything else (a declared serves() change in both folders).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, dcHomeSales, isDcRequest } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City, Cook County IL and Washington DC only; not nationwide",
  placeName: "Washington, DC",
  status: "live",
  serves: (p) => isDcRequest(p),
  paramNotes: {
    town: "US: for Washington DC write 'Washington, DC' (a bare 'Washington' means the town in Connecticut).",
    property_type: "US, Washington DC: any (default), house (houses and rowhouses) or condo.",
    months: "US, Washington DC: 1 to 36 months back from the latest sale in the tables.",
  },
  examples: [{ params: { country: "US", town: "Washington, DC" } }],
  method:
    "US (Washington, DC): median and 10th–90th percentile of qualified (arm's-length) house, rowhouse and condo sales of $10,000 or more, read live from the District's assessment (CAMA) sale tables; whole District only; never addresses.",
  handle: (p, ctx) =>
    dcHomeSales({
      town: str(p.town),
      postcode: str(p.postcode),
      state: str(p.state),
      property_type: str(p.property_type),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
});
