// Manifest: official house price index (Eurostat prc_hpi_q) for EU countries that have no national home-sales source here. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, euHomePriceIndex, hpiHarvest, hpiHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Eurostat house price index (2015 = 100, an official index, NOT a price in money) for: " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", ") + "",
  placeName: "Bulgaria, Croatia, Cyprus, Czechia, Estonia, Germany, Hungary, Iceland, Italy, Latvia, Lithuania, Luxembourg, Malta, Poland, Romania, Slovakia, Slovenia and Spain (house price index only)",
  status: "live",
  paramNotes: {
    town: "BG HR CY CZ DE EE ES HU IS IT LV LT LU MT PL RO SI SK: ignored; Eurostat publishes one national index per country (PL: a town is answered by the Polish price register instead). The answer is an index (2015 = 100), not a price in euros.",
    postcode: "BG HR CY CZ DE EE ES HU IS IT LV LT LU MT PL RO SI SK: not supported (national index only).",
    property_type: "BG HR CY CZ DE EE ES HU IS IT LV LT LU MT PL RO SI SK: ignored; the index covers all dwellings (new and existing) bought by households.",
    months: "BG HR CY CZ DE EE ES HU IS IT LV LT LU MT PL RO SI SK: ignored; the newest quarter with a figure is returned, with the change over the previous quarter and over a year.",
  },
  examples: [
    { params: { country: "ES" } },
    { params: { country: "DE" }, smoke: false },
    { params: { country: "PL" }, smoke: false },
  ],
  // Poland also has pl-rcn-home-sales (flat sales per city): a request naming a town goes there, without a town it gets this national index.
  serves: (p) => !str(p.town),
  method:
    "Eurostat's quarterly house price index (2015 = 100) of the prices households paid for dwellings, built by each national statistics office from purchase transactions. We pass on the latest published index with its change over a quarter and a year; it is an official index, not a price in money and not a list of sales.",
  // Stale-if-error copy: the collector stores Eurostat's newest quarterly index for every country once a day (rows dated by the quarter's end).
  harvest: () => hpiHarvest(),
  historyKey: (p) => hpiHistoryKey({ country: str(p.country), town: str(p.town), postcode: str(p.postcode) }),
  referenceDates: true,
  staleMaxDays: 35,
  nominalCounts: true,
  noHistory: "Eurostat house price index: ProofPrice keeps only the newest quarter as a stand-in copy, not a separate history yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the latest index, which carries the previous quarter and the year earlier.",
  handle: (p, ctx) => euHomePriceIndex({ country: String(p.country), baseUrl: ctx.baseUrl }),
});
