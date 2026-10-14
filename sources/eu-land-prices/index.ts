// Manifest: farmland prices and rents for EU member states and Norway (Eurostat apri_lprc and apri_lrnt). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, euLandPrices, INFO, LAND_TYPES, regionsOf } from "./source";

const typesFor = (m: "price" | "rent") =>
  LAND_TYPES.filter((t) => t.measures.includes(m)).map((t) => `"${t.key}" = ${t.label}`).join("; ");

const regionExamples = ["ES51", "ES61", "FRJ2", "IE05", "NL32", "PT11", "PL91", "SE11"]
  .map((code) => {
    const hit = regionsOf(code.slice(0, 2)).find((r) => r.code === code);
    return hit ? `${code} = ${hit.name}` : null;
  })
  .filter(Boolean)
  .join(", ");

export default defineSource({
  info: INFO,
  category: "land-prices",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "EU member states and Norway, as ISO codes (GR for Greece): " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", ") +
    ". Not covered: DE, CY (Eurostat holds no farmland data) and GB. Belgium's sale prices end in 2014 and Italy's in 2020; Norway has rents only.",
  placeName: "EU member states and Norway",
  status: "live",
  paramNotes: {
    measure:
      "EU/NO: price = average sale price of agricultural land per hectare (Eurostat apri_lprc); rent = average rent for one year per hectare (apri_lrnt). " +
      "Rents exist for most countries, prices for most but not NO.",
    land_type:
      `EU/NO, optional. For price: ${typesFor("price")}. For rent: ${typesFor("rent")}. ` +
      "Leave out for the usual one (price: arable; rent: arable and/or grassland). Not every country reports every land type; the answer lists what exists.",
    region:
      `EU/NO, optional. A NUTS region code (Eurostat's regional land data), e.g. ${regionExamples}. Leave out for the whole country. ` +
      "Every national answer lists its regions in extra.regions_available. Regions exist only for some countries and years: a code Eurostat does not hold gets a clear no_matches.",
  },
  examples: [
    { params: { country: "IE", measure: "price" } },
    { params: { country: "ES", measure: "price", region: "ES51" }, smoke: false },
    { params: { country: "FR", measure: "rent" }, smoke: false },
    { params: { country: "PL", measure: "price", land_type: "permanent grassland" }, smoke: false },
  ],
  method:
    "Farmland prices and rents: the official average price (or yearly rent) per hectare of agricultural land that Eurostat publishes once a year for each country and region, by land type. We pass on the published figure and its reference year; it is an average, not a list of sales, and it arrives about two years late.",
  handle: (p, ctx) =>
    euLandPrices({
      country: String(p.country),
      measure: String(p.measure ?? ""),
      land_type: str(p.land_type),
      region: str(p.region),
      baseUrl: ctx.baseUrl,
    }),
});
