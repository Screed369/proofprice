// Manifest: Belgium home prices (Statbel open data, official median sale prices by property type and municipality). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, beHarvest, beHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["BE"],
  countryHelp: "BE = Belgium (official Statbel median sale prices by property type, quarterly)",
  placeName: "Belgium",
  status: "live",
  paramNotes: {
    town:
      "BE: a municipality in Dutch, French or English ('Antwerpen' / 'Antwerp' / 'Anvers', 'Gent' / 'Ghent', 'Brussel' / 'Bruxelles' / 'Brussels', 'Liège'), or a province ('province of Namur') or region ('Flanders', 'Wallonia', 'Brussels Capital Region'). Omit for Belgium. Official Statbel medians, not a list of sales.",
    postcode: "BE: not supported (Statbel publishes by municipality); give the municipality as town.",
    property_type:
      "BE: house (all houses, not apartments), apartment, or detached / villa (houses with 4 or more facades), semi-detached or terraced (houses with 2 or 3 facades). Statbel has no figure for houses and apartments together, so without a type you get both medians in the summary and no single price.",
    months: "BE: ignored; Statbel publishes quarters, half-years and years, and the latest period with a figure for the place is returned.",
  },
  paramValues: { property_type: ["house", "apartment", "villa", "detached", "semi-detached", "terraced"] },
  examples: [
    { params: { country: "BE", town: "Antwerpen", property_type: "apartment" } },
    { params: { country: "BE", town: "Gent", property_type: "house" }, smoke: false },
    { params: { country: "BE", town: "Brussels", property_type: "apartment" }, smoke: false },
  ],
  method:
    "Belgium: the official median sale price (with the 25th and 75th percentile and the number of transactions) that Statbel publishes per type of property, municipality, province and region; we collect the newest quarter, half-year and year from Statbel's open-data file once a day and answer from that copy.",
  handle: async (p, ctx) =>
    beHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
  harvest: beHarvest,
});
