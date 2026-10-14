// Manifest: Norway home prices (official price per m² of existing dwellings, Statistics Norway). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, norwayHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["NO"],
  countryHelp: "NO = Norway (official average price per m² from Statistics Norway, by municipality or county; an official statistic, not individual sales)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    town:
      "NO: a municipality ('Oslo', 'Bergen', 'Tromsø' or 'Tromso', 'Stavanger') or a county ('Rogaland', 'Vestland'), Norwegian or Sami spelling, with or without æ ø å. Omit for the whole country. " +
      "Answers are Statistics Norway's published average price per m² (NOK) with the number of sales, not a list of sales.",
    postcode: "NO: not supported (Statistics Norway publishes by municipality); give town instead.",
    property_type:
      "NO: any (all dwellings, default), house or detached (detached houses), terraced (row houses), flat (multi-dwelling buildings). Official price per m² of existing dwellings.",
    months: "NO: not used; Statistics Norway publishes one figure per quarter and the answer gives the latest quarter plus the previous one and a year earlier.",
  },
  paramValues: { property_type: ["house", "detached", "terraced", "flat"] },
  examples: [
    { params: { country: "NO", town: "Oslo" } },
    { params: { country: "NO", town: "Bergen", property_type: "flat" }, smoke: false },
    { params: { country: "NO", town: "Tromso", property_type: "detached" }, smoke: false },
  ],
  method:
    "Norway: Statistics Norway's quarterly average price per m² of existing dwellings (table 14310) by municipality, county or the whole country and by dwelling type, with the number of sales. We pass on the published average unchanged, with the previous quarter and a year earlier; it is an official statistic, not a list of sales.",
  handle: (p, ctx) =>
    norwayHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
});
