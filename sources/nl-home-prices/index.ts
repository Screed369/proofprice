// Manifest: Netherlands home prices (CBS, official average sale price by municipality). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { INFO, nlHarvest, nlHistoryKey, nlHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["NL"],
  countryHelp: "NL = Netherlands (official CBS average sale price per municipality, annual)",
  placeName: "the Netherlands",
  status: "live",
  paramNotes: {
    town:
      "NL: a municipality ('Amsterdam', 'Den Haag' / 'The Hague' / 's-Gravenhage, 'Utrecht') or a province ('Noord-Holland'). Omit for the national average. Official CBS annual average, not a list of sales.",
    postcode: "NL: not supported (CBS publishes by municipality); give the municipality as town.",
    property_type: "NL: CBS does not split this figure by home type; only 'any' (all existing owner-occupied homes) has an answer.",
    months: "NL: ignored; CBS publishes one average per calendar year (the latest is returned).",
  },
  examples: [
    { params: { country: "NL", town: "Amsterdam" } },
    { params: { country: "NL", town: "Den Haag" }, smoke: false },
    { params: { country: "NL" }, smoke: false },
  ],
  method:
    "Netherlands: the official average sale price of existing owner-occupied homes per municipality, province and country that Statistics Netherlands (CBS) publishes once a year from Kadaster notarial transactions (table 83625NED). We pass on the published figure for the latest year, with the change on the year before and the national average; it is an average, not a price index, and not split by home type.",
  handle: (p, ctx) =>
    nlHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
  // Stale-if-error copy: the collector stores CBS's newest annual average for every region once a day, so a CBS outage is
  // answered from it. One published average per region and year (n is NO_COUNT), dated by the end of the year it is for.
  harvest: () => nlHarvest(),
  historyKey: (p) =>
    nlHistoryKey(
      { town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type) },
      [...new Set((readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area))],
    ),
  referenceDates: true,
  nominalCounts: true,
  staleMaxDays: 35, // CBS publishes once a year; the newest figure cannot change between releases
  noHistory: "Netherlands: CBS publishes one average per year and ProofPrice keeps no separate history of it yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure, which carries the previous year and a six-year series.",
});
