// Manifest: England and Wales rents (ONS Price Index of Private Rents). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, gbHarvest, gbRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["GB"],
  countryHelp: "GB = England and Wales (ONS average private rents; Scotland and Northern Ireland are not covered)",
  placeName: "England and Wales",
  status: "live",
  paramNotes: {
    town: "GB: required. A local authority (Manchester, Leeds, Camden, Cardiff), an English region (London, North West) or England / Wales. Towns and postcodes are not published; Bristol, Hull etc. match their council area.",
    postcode: "GB: not used (rents are published by local authority); give the area name in town.",
    property_type: "GB: apartment (flat) or house; leave out for all homes. For house, also give house_type. Rooms are not published. Not together with bedrooms.",
    bedrooms: "GB: 1, 2, 3 or 4 (4 means four or more); leave out for all sizes. Studios are not published. Not together with property_type.",
    months: "GB: ignored; the figure is for the latest month published.",
    house_type: "GB: detached, semi-detached or terraced; required with property_type house.",
  },
  examples: [
    { params: { country: "GB", town: "Manchester" } },
    { params: { country: "GB", town: "Westminster", bedrooms: "2" }, smoke: false },
    { params: { country: "GB", town: "Cardiff", property_type: "house", house_type: "terraced" }, smoke: false },
  ],
  method:
    "England and Wales rents: the collector reads the ONS Price Index of Private Rents spreadsheet each day into our price library; answers are the average monthly private rent the ONS publishes for the latest month, for the chosen local authority, region or country and for all homes, by bedrooms or by property type, with the published annual change. An official average of new and existing tenancies, not a range of individual rents.",
  handle: (p, ctx) =>
    gbRents({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
  nominalCounts: true,
  harvest: gbHarvest,
});
