// Manifest: Portugal home prices (INE, official median sale price per m² by region and municipality). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ptHarvest, ptHistoryKey, ptHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["PT"],
  countryHelp: "PT = Portugal (official INE median sale price per m², quarterly, by region and municipality)",
  placeName: "Portugal",
  status: "live",
  paramNotes: {
    town:
      "PT: a municipality INE publishes ('Lisboa' / 'Lisbon', 'Porto' / 'Oporto', 'Cascais', 'Faro', 'Funchal' ... 58 in all) or a region ('Algarve', 'Grande Lisboa', 'Madeira', 'Açores'). Omit for Portugal as a whole. Official INE median per m² of the last 12 months of sales, not a list of sales.",
    postcode: "PT: not supported (INE publishes by region and municipality); give the municipality as town.",
    property_type: "PT: INE splits by number of bedrooms, not by house or apartment; only 'any' has an answer (the answer includes the split by bedrooms).",
    months: "PT: ignored; INE publishes one median per quarter, covering the 12 months to the quarter's end (the latest is returned).",
  },
  examples: [
    { params: { country: "PT", town: "Lisboa" } },
    { params: { country: "PT", town: "Porto" }, smoke: false },
    { params: { country: "PT" }, smoke: false },
  ],
  method:
    "Portugal: the official median sale price per square metre of the dwellings sold in the previous 12 months that Statistics Portugal (INE) publishes every quarter for the country, regions and 58 municipalities (indicator 0012241). We pass on the published figure for the latest quarter, with the year earlier, the national median and the split by bedrooms; it is a price per m², not per home, and not split by house or apartment.",
  handle: (p, ctx) =>
    ptHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
  // Stale-if-error copy: the collector stores INE's newest quarterly median for every place once a day (rows dated by the quarter's end).
  harvest: () => ptHarvest(),
  historyKey: (p) => ptHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Portugal: INE publishes one rolling-12-month median per quarter and ProofPrice keeps no separate history of it yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure, which carries the previous quarter and the year earlier.",
});
