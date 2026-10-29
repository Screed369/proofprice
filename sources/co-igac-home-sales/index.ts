// Manifest: Colombia property sales (IGAC land-registry sale deeds on datos.gov.co, 2015 to 2023). Logic lives in ./source.ts.
// Licence is CC BY-SA 4.0 (share-alike, not cleared for sale): answered on the free tier only, the code never charges for it.
import { defineSource, num, str } from "../../lib/plugin";
import { coHomeSales, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CO"],
  countryHelp: "CO = Colombia (declared values in registered sale deeds by municipality, 2015 to 2023 only)",
  placeName: "Colombia",
  status: "live",
  paramNotes: {
    town: "CO: a municipality ('Medellín', 'Bogotá', 'Cali', 'Barranquilla'; accents optional). If two municipalities share a name write 'Name, Department'.",
    postcode: "CO: not supported; the data is by municipality, so give the municipality as town.",
    property_type: "CO: any (default), urban or rural (the registry's zone of the property). Land, flats and houses are mixed in each.",
    months: "CO: the data is yearly: 1 to 12 gives the newest year with sales, 13 to 24 two years, 25 to 36 three years.",
  },
  paramValues: { property_type: ["urban", "rural"] },
  examples: [
    { params: { country: "CO", town: "Medellin" } },
    { params: { country: "CO", town: "Bogotá", property_type: "urban" }, smoke: false },
  ],
  method:
    "Colombia: median and 10th–90th percentile of the value declared in registered property sale deeds (IGAC land-registry annotations on datos.gov.co) for a municipality and year; the data ends in 2023, values are declared in the deed, and land, flats and houses are mixed.",
  handle: (p, ctx) => coHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
