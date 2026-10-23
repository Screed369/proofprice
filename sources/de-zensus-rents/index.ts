// Manifest: Germany rents (Destatis Zensus 2022, average net cold rent per m2 by 1 km grid square, summarised per city). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, deHarvest, deRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["DE"],
  countryHelp: "DE = Germany (Zensus 2022 average net cold rent per m2 around the city centre, census of May 2022, official statistic)",
  placeName: "Germany",
  status: "live",
  paramNotes: {
    town: "DE: required. One of about 90 German cities, e.g. Berlin, Hamburg, München (Munich), Köln (Cologne), Frankfurt am Main, Stuttgart, Düsseldorf, Leipzig, Dresden.",
    postcode: "DE: not supported; give the city as town.",
    property_type: "DE: leave out. The census figure covers all rented dwellings together (flats and houses).",
    house_type: "DE: not used.",
    bedrooms: "DE: not supported (all sizes together); leave out.",
    months: "DE: ignored; the figure is the census of 15 May 2022.",
  },
  examples: [
    { params: { country: "DE", town: "Berlin" } },
    { params: { country: "DE", town: "München" }, smoke: false },
    { params: { country: "DE", town: "Leipzig" }, smoke: false },
  ],
  method:
    "Germany rents: the Zensus 2022 average net cold rent per m2 (rent agreed in existing contracts, census date 15 May 2022) that Destatis publishes for every 1 km grid square; we take the squares around a city centre and report their median and 10th-90th percentile. A census snapshot, not an asking rent.",
  handle: async (p, ctx) =>
    deRent({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
  // The file is static (census date); collected once into the library and answered from there.
  harvest: deHarvest,
  historyKey: () => null,
  noHistory: "Germany: the census rent grid is a single snapshot (15 May 2022), so there is no history. Ask pricepaid_rent_prices (/api/v1/rent) for the figure.",
  referenceDates: true,
  nominalCounts: true,
});
