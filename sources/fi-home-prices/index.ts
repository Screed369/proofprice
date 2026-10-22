// Manifest: Finland home prices (official price per m² of old dwellings in housing companies, Statistics Finland). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { finlandHomePrices, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["FI"],
  countryHelp: "FI = Finland (official average price per m² of old dwellings in housing companies from Statistics Finland, by municipality, region or postcode; an official statistic, not individual sales)",
  placeName: "Finland",
  status: "live",
  paramNotes: {
    town:
      "FI: a municipality ('Helsinki' or 'Helsingfors', 'Espoo', 'Tampere', 'Oulu', 'Hämeenlinna'), a region ('Uusimaa', 'Pirkanmaa'), 'Greater Helsinki', with or without ä ö å. " +
      "Omit for Finland as a whole. Larger cities, regions and the country have quarterly figures (with the official price-index changes); other municipalities have the latest yearly figure.",
    postcode:
      "FI: a five-digit postcode (for example 00100): the latest yearly figure for that postal code area. Flats are published by number of rooms, so the answer is the room size with most transactions and the others are listed.",
    property_type:
      "FI: flat (flats in blocks of flats), terraced (terraced houses, which also include detached houses with shares in a housing company). Without a type, all building types. House and detached are not covered.",
    months: "FI: not used; Statistics Finland publishes one average per quarter (postcodes, cities) or year (municipalities).",
  },
  paramValues: { property_type: ["house", "detached", "terraced", "flat"] },
  examples: [
    { params: { country: "FI", town: "Helsinki" } },
    { params: { country: "FI", postcode: "00100", property_type: "flat" }, smoke: false },
    { params: { country: "FI", town: "Tampere", property_type: "terraced" }, smoke: false },
  ],
  method:
    "Finland: Statistics Finland's average price per square metre and number of transactions of old dwellings in housing companies (flats in blocks and terraced houses), from the Tax Administration's transfer tax data: " +
    "quarterly for the country, regions and larger cities (with the official price-index changes), yearly by postal code area and by municipality. " +
    "We pass on the published figure in euros per m²; the newest periods are provisional. It is an official statistic, not a list of sales.",
  handle: (p, ctx) =>
    finlandHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
});
