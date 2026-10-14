// Manifest: Norway rents (Statistics Norway Rental market survey, table 09895). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, noRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["NO"],
  countryHelp: "NO = Norway (Statistics Norway rental market survey)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    town: "NO: required. A price zone: 'Norway' (whole country), 'Oslo', 'Akershus', 'Bergen', 'Trondheim', 'Stavanger', 'large towns', 'medium towns' or 'small towns'.",
    postcode: "NO: not used; give a price zone as town.",
    property_type: "NO: not used (the survey does not split by home type).",
    bedrooms: "NO: not used; use rooms instead (Norway counts rooms).",
    months: "NO: ignored; the figure is for the latest year published.",
  },
  extraParams: {
    rooms: z.number().int().min(1).max(10).optional().describe("NO only: number of rooms (living rooms plus bedrooms), 1 to 5 (5 means five or more). Required for Norway."),
  },
  examples: [
    { params: { country: "NO", town: "Oslo", rooms: "2" } },
    { params: { country: "NO", town: "Norway", rooms: "3" }, smoke: false },
  ],
  method:
    "Norway rents: the weighted average monthly rent of rented homes from Statistics Norway's annual Rental market survey (table 09895), by price zone and number of rooms. It is a published average with its year, not a list of rents.",
  handle: (p, ctx) => noRent({ town: str(p.town), rooms: num(p.rooms), baseUrl: ctx.baseUrl }),
});
