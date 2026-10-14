// Manifest: Singapore rents (HDB "Renting Out of Flats"). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, SG_FLAT_TYPES, sgRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["SG"],
  countryHelp: "SG = Singapore HDB public-housing flats",
  placeName: "Singapore public housing",
  status: "live",
  paramNotes: {
    town: "SG: required, an HDB town such as 'Tampines', 'Bedok' or 'Toa Payoh'.",
    postcode: "SG: not used; give an HDB town.",
    property_type: "SG: ignored; every record is an HDB flat. Use flat_type for the size.",
    bedrooms: "SG: ignored; HDB counts rooms, not bedrooms. Use flat_type ('4-ROOM').",
    months: "SG: window of recent months, 1 to 36. Default 12.",
  },
  extraParams: {
    flat_type: z.string().optional().describe(`SG only: HDB flat type, one of ${SG_FLAT_TYPES.join(", ")} ('4 ROOM' also works). Leave out for all types.`),
  },
  examples: [
    { params: { country: "SG", town: "Tampines", flat_type: "4 ROOM" } },
    { params: { country: "SG", town: "Bedok" }, smoke: false },
  ],
  method:
    "Singapore rents: median and 10th–90th percentile of the monthly rents of HDB flats approved for renting out, by town, flat type and recent window (data.gov.sg). The rents are owner-declared and not verified by HDB; private condominiums are not included.",
  handle: (p, ctx) => sgRents({ town: str(p.town), flat_type: str(p.flat_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
