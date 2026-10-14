// Manifest: Sweden home prices (official average purchase prices of houses and tenant-owned flats, Statistics Sweden). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, swedenHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["SE"],
  countryHelp: "SE = Sweden (official average purchase price from Statistics Sweden, by municipality or county; an official statistic, not individual sales)",
  placeName: "Sweden",
  status: "live",
  paramNotes: {
    town:
      "SE: a municipality ('Stockholm', 'Göteborg' or 'Gothenburg', 'Malmö' or 'Malmo', 'Uppsala'), a county ('Skåne', 'Stockholms län') or a metropolitan area ('Greater Gothenburg'), with or without å ä ö. " +
      "Omit for Sweden as a whole. Answers are Statistics Sweden's published average purchase price (SEK per home) with the number of sales, not a list of sales.",
    postcode: "SE: not supported (Statistics Sweden publishes by municipality); give town instead.",
    property_type:
      "SE: house (one- and two-dwelling buildings; the default for any), flat (tenant-owned flats, median price, county or metropolitan area only). Villas, terraced and semi-detached houses are not split, so detached and terraced return no figure.",
    months: "SE: not used; Statistics Sweden publishes one figure per year (municipalities, flats) or quarter (counties).",
  },
  paramValues: { property_type: ["house", "detached", "terraced", "flat"] },
  examples: [
    { params: { country: "SE", town: "Stockholm" } },
    { params: { country: "SE", town: "Goteborg", property_type: "flat" }, smoke: false },
    { params: { country: "SE", town: "Skåne", property_type: "house" }, smoke: false },
  ],
  method:
    "Sweden: Statistics Sweden's average purchase price of one- and two-dwelling buildings (municipalities yearly, counties and Sweden quarterly) and of tenant-owned flats (counties, metropolitan areas and Sweden yearly), with the number of sales. We pass on the published figure in SEK with the previous period; it is an official statistic, not a list of sales.",
  handle: (p, ctx) =>
    swedenHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
});
