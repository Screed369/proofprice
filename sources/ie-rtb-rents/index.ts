// Manifest: Ireland rents (RTB Average Monthly Rent Report via the CSO). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { HOUSE_TYPE_NAMES, INFO, ieRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["IE"],
  countryHelp: "IE = Ireland (registered tenancies, Residential Tenancies Board)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    town: "IE: required. A county ('Dublin', 'Cork'), a town ('Swords, Dublin', 'Galway City') or a Dublin district ('Dublin 6').",
    postcode: "IE: not used (Eircodes are not published); give a town.",
    property_type: "IE: apartment (flat) or house; leave out for all homes. For house, also give house_type. Rooms are not published.",
    bedrooms: "IE: 1, 2, 3 or 4 (4 means four or more); leave out for all sizes. Studios are not published.",
    months: "IE: ignored; the figure is for the latest quarter published.",
  },
  extraParams: {
    house_type: z.enum(HOUSE_TYPE_NAMES).optional().describe("IE only: detached, semi-detached or terraced house (needed when property_type is house)."),
  },
  examples: [
    { params: { country: "IE", town: "Dublin" } },
    { params: { country: "IE", town: "Swords, Dublin", property_type: "apartment", bedrooms: "2" }, smoke: false },
  ],
  method:
    "Ireland rents: the average monthly rent of tenancies registered with the Residential Tenancies Board in the latest quarter, published by the CSO as table RIQ02. It is the actual (not standardised) average, passed on with its quarter; it is an average, not a list of rents.",
  handle: (p, ctx) =>
    ieRent({
      town: str(p.town),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
});
