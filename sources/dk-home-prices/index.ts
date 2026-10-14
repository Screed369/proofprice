// Manifest: Denmark home prices (official average price per property of one-family houses and owner-occupied flats, Statistics Denmark). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { denmarkHomePrices, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["DK"],
  countryHelp: "DK = Denmark (official average price per property from Statistics Denmark, by province and region; an official statistic, not individual sales)",
  placeName: "Denmark",
  status: "live",
  paramNotes: {
    town:
      "DK: a municipality or town ('København' or 'Copenhagen', 'Aarhus' or 'Århus', 'Odense', 'Aalborg'), a province ('Fyn', 'Østjylland', 'Nordsjælland') or a region ('Hovedstaden', 'Syddanmark'), with or without æ ø å. " +
      "Statistics Denmark publishes by province, so a municipality is answered with the province it lies in (and the answer says which). Omit for Denmark as a whole.",
    postcode: "DK: not supported (Statistics Denmark publishes by province and region); give town instead.",
    property_type:
      "DK: house (one-family houses), flat (owner-occupied flats). Without a type, the group with more sales in that place is answered and the other is in extra. Detached and terraced are not published separately.",
    months: "DK: not used; Statistics Denmark publishes one average per quarter.",
  },
  paramValues: { property_type: ["house", "detached", "terraced", "flat"] },
  examples: [
    { params: { country: "DK", town: "København" } },
    { params: { country: "DK", town: "Aarhus", property_type: "flat" }, smoke: false },
    { params: { country: "DK", town: "Fyn", property_type: "house" }, smoke: false },
  ],
  method:
    "Denmark: Statistics Denmark's average purchase price per property for ordinary free-trade sales of one-family houses and owner-occupied flats, with the number of sales, by quarter for each province, region and all of Denmark. " +
    "We pass on the published figure in DKK with the previous quarter and the year before; the latest quarters are preliminary (average prices are underestimated until final). It is an official statistic, not a list of sales.",
  handle: (p, ctx) =>
    denmarkHomePrices({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      baseUrl: ctx.baseUrl,
    }),
});
