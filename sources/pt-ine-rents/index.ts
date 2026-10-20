// Manifest: Portugal rents (INE, official median rent per m² of new lease contracts by region and municipality). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, ptRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["PT"],
  countryHelp: "PT = Portugal (official INE median rent per m² per month of new leases, quarterly, by region and all 308 municipalities)",
  placeName: "Portugal",
  status: "live",
  paramNotes: {
    town:
      "PT: any municipality ('Lisboa' / 'Lisbon', 'Porto', 'Cascais', 'Faro', 'Funchal', 'Coimbra' ... all 308) or a region ('Algarve', 'Grande Lisboa', 'Madeira', 'Açores'). Omit for Portugal as a whole. Official INE median monthly rent per m² of new leases of the last 12 months (not per home).",
    postcode: "PT: not supported (INE publishes by region and municipality); give the municipality as town.",
    property_type: "PT: INE publishes one figure for all dwellings; only 'any' has an answer.",
    bedrooms: "PT: not supported (INE does not split by bedrooms).",
    months: "PT: ignored; INE publishes one median per quarter, covering the 12 months to the quarter's end (the latest is returned).",
  },
  examples: [
    { params: { country: "PT", town: "Lisboa" } },
    { params: { country: "PT", town: "Porto" }, smoke: false },
    { params: { country: "PT" }, smoke: false },
  ],
  method:
    "Portugal: the official median monthly rent per square metre of the new lease contracts of dwellings registered in the previous 12 months that Statistics Portugal (INE) publishes every quarter for the country, regions and every municipality (indicator 0014696). We pass on the published figure for the latest quarter, with the year earlier and the national median; it is a rent per m² per month for new leases only, not a rent per home, and not split by house or apartment.",
  handle: (p, ctx) => ptRents({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), bedrooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
});
