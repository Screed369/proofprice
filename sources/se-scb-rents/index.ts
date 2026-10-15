// Manifest: Sweden rents (Statistics Sweden rent survey, table BO0406). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, seRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["SE"],
  countryHelp: "SE = Sweden (Statistics Sweden rent survey)",
  placeName: "Sweden",
  status: "live",
  paramNotes: {
    town: "SE: optional region group: 'Sweden' (default), 'Greater Stockholm', 'Greater Gothenburg', 'Greater Malmo', 'large municipalities' or 'small municipalities'.",
    postcode: "SE: not used.",
    property_type: "SE: not used (flats in rented buildings).",
    bedrooms: "SE: required; give the number of ROOMS (Sweden counts rooms, not bedrooms): 1, 2, 3 or 4 (4 means four or more).",
    months: "SE: ignored; the figure is for the latest year published.",
  },
  examples: [
    { params: { country: "SE", town: "Greater Stockholm", bedrooms: "2" } },
    { params: { country: "SE", bedrooms: "3" }, smoke: false },
  ],
  method:
    "Sweden rents: the median annual rent of rented flats (private and other owners) divided by 12, from Statistics Sweden's annual rent survey (table BO0406), by region group and number of rooms. It is a published median with its year, not a list of rents.",
  handle: (p, ctx) => seRent({ town: str(p.town), rooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
});
