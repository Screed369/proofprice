// Manifest: United States national new-house sale price (Census Bureau New Residential Sales). Shares the "home-sales" country US with
// us-home-sales (CT, NYC, Cook County) and us-dc-home-sales: this source serves the explicit NATIONAL question (property_type new, or town 'United States'; no ZIP or state) and the
// others serve a named place. Its serves() says no to every place, so the other folders are unchanged. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, isNationalRequest, usNewHomeHarvest, usNewHomeHistoryKey, usNewHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["US"],
  countryHelp: "US = United States, partial: Connecticut, New York City, Cook County IL and Washington DC by town; the whole country for new houses (Census Bureau national median)",
  placeName: "the United States (national median for new houses)",
  status: "live",
  serves: (p) => isNationalRequest(p),
  paramNotes: {
    town: "US: for the national median price of NEW houses sold (Census Bureau) leave town out and set property_type to new (or write town 'United States'); a place name is answered by the town sources.",
  },
  paramValues: { property_type: ["new"] },
  examples: [{ params: { country: "US", property_type: "new" } }],
  method:
    "US (national): the Census Bureau's New Residential Sales median sales price of new privately-owned houses sold, for the latest month it has published, with the change on the month and the year before. A published national median, not a list of sales; no state or city figure.",
  handle: (p, ctx) =>
    usNewHomeSales({
      town: str(p.town),
      postcode: str(p.postcode),
      state: str(p.state),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
  // Stale-if-error copy: the newest month's national median, dated by the reference month.
  harvest: () => usNewHomeHarvest(),
  historyKey: (p) => usNewHomeHistoryKey({ town: str(p.town), postcode: str(p.postcode), state: str(p.state), property_type: str(p.property_type) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory:
    "US new-house price: the Census Bureau publishes one national median a month and ProofPrice keeps no separate history of it yet. Ask pricepaid_home_sales (country US, property_type new, no town) for the newest figure, which carries the previous month, the year earlier and the last 12 months.",
});
