// Manifest: Colombia property sales (IGAC land-registry sale deeds on datos.gov.co, 2015 to 2023). Logic lives in ./source.ts.
// Licence is CC BY-SA 4.0 (share-alike, not cleared for sale): answered on the free tier only, the code never charges for it.
import { defineSource, num, str } from "../../lib/plugin";
import { coHarvest, coHistoryKey, coHomeSales, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CO"],
  countryHelp: "CO = Colombia (declared values in registered sale deeds by municipality, 2015 to 2023 only)",
  placeName: "Colombia",
  status: "live",
  paramNotes: {
    town: "CO: a municipality ('Medellín', 'Bogotá', 'Cali', 'Barranquilla'; accents optional). If two municipalities share a name write 'Name, Department'. Leave out for all of Colombia.",
    postcode: "CO: not supported; the data is by municipality, so give the municipality as town.",
    property_type: "CO: any (default), urban or rural (the registry's zone of the property). Land, flats and houses are mixed in each.",
    months: "CO: the data is yearly: 1 to 12 gives the newest year with sales, 13 to 24 two years, 25 to 36 three years.",
  },
  paramValues: { property_type: ["urban", "rural"] },
  examples: [
    { params: { country: "CO", town: "Medellin" } },
    { params: { country: "CO", town: "Bogotá", property_type: "urban" }, smoke: false },
    { params: { country: "CO" }, smoke: false },
  ],
  method:
    "Colombia: median and 10th–90th percentile of the value declared in registered property sale deeds (IGAC land-registry annotations on datos.gov.co) for a municipality and year; collected into our price library, the data ends in 2023, values are declared in the deed, and land, flats and houses are mixed.",
  referenceDates: true,
  harvest: () => coHarvest(),
  noHistory: "Colombia: the registry data is frozen (it ends in 2023), so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales (/api/v1/home-sales) for the figure by municipality and year.",
  historyKey: (p) => coHistoryKey({ town: str(p.town), property_type: str(p.property_type) }),
  handle: (p, ctx) => coHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
