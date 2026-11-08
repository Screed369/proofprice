// Manifest: Germany / North Rhine-Westphalia home guideline values (BORIS.NRW Immobilienrichtwerte, official valuation statistic, EUR per m2). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nrwHarvest, nrwHistoryKey, nrwHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["DE"],
  countryHelp: "DE = Germany, North Rhine-Westphalia only (official BORIS.NRW guideline values per m2, a valuation statistic derived from registered purchase prices)",
  placeName: "Germany (North Rhine-Westphalia)",
  status: "live",
  paramNotes: {
    town:
      "DE: a town in North Rhine-Westphalia only ('Köln' / 'Cologne', 'Düsseldorf', 'Dortmund', 'Essen', 'Münster', 'Bielefeld', 'Bonn', 'Aachen'). Without a town the answer is Germany's national Eurostat house price index (an index, not a price in money). Berlin, Munich, Hamburg and the other states are not covered by the per-m2 guideline values.",
    postcode: "DE: not supported; give the town as town.",
    property_type:
      "DE: apartment (default when left out), house (detached one- and two-family) or terraced (terraced and semi-detached). The figure is the guideline value per m2 of living area for a standard property (a valuation statistic derived from purchase prices), resales only.",
    months: "DE: ignored; the values are fixed once a year at 1 January.",
  },
  paramValues: { property_type: ["apartment", "house", "terraced"] },
  examples: [
    { params: { country: "DE", town: "Köln", property_type: "apartment" } },
    { params: { country: "DE", town: "Münster", property_type: "house" }, smoke: false },
    { params: { country: "DE", town: "Düsseldorf", property_type: "terraced" }, smoke: false },
  ],
  method:
    "Germany (NRW): the Immobilienrichtwerte that the local expert committees fix each 1 January in EUR per m2 of living area for a standard property in each location zone, derived from registered purchase prices; we report the median and 10th-90th percentile of the zone values of a town. A valuation statistic, not an asking price and not a list of sales.",
  // Germany also has the Eurostat house price index (eu-home-price-index): a request naming a town goes here, without a town it gets that national index.
  serves: (p) => !!str(p.town),
  handle: async (p, ctx) =>
    nrwHomePrices({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
  // The file is collected once a day into the library; answers are read from it, and a geoportal outage is answered from the stored copy.
  harvest: nrwHarvest,
  historyKey: (p) => nrwHistoryKey({ town: str(p.town) ?? str(p.area), property_type: str(p.property_type) }),
  noHistory: "Germany (NRW): the committees fix one guideline value per zone and year, so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure.",
  referenceDates: true,
  nominalCounts: true,
});
