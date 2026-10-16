// Manifest: Catalonia (Spain) rents from the INCASOL rental-deposit register. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, esCatRent } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["ES"],
  countryHelp: "ES = Spain (Catalonia only: INCASOL registered lease deposits)",
  placeName: "Catalonia, Spain",
  status: "live",
  paramNotes: {
    town: "ES: required; a Catalan municipality, e.g. 'Barcelona', 'Sabadell', 'Girona' (Spanish or Catalan spelling).",
    postcode: "ES: not used.",
    property_type: "ES: not used (all homes together).",
    bedrooms: "ES: not used.",
    months: "ES: ignored; the figure is for the latest published quarter.",
  },
  examples: [
    { params: { country: "ES", town: "Barcelona" } },
    { params: { country: "ES", town: "Sabadell" }, smoke: false },
  ],
  method:
    "Catalonia rents: the average monthly rent of home leases newly lodged with INCASOL (the legal rental deposit) in a municipality in the latest quarter, with the number of contracts. It is a published average, not a list of rents.",
  handle: (p, ctx) => esCatRent({ town: str(p.town), baseUrl: ctx.baseUrl }),
});
