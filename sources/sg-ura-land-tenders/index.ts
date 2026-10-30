// Manifest: Singapore state-land sites sold by tender (URA Government Land Sales results on data.gov.sg), in the commercial-property tool as land. Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, sgLandTenders } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["SG"],
  countryHelp: "SG = Singapore (state-land tender awards 1992 to mid-2016, SGD per m² of gross floor area)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    town: "SG: a URA planning area, e.g. Bedok, Downtown Core, Geylang, Woodlands, Queenstown, River Valley. Leave out for all of Singapore. At least 5 sites must match.",
    postcode: "SG: not supported; give the planning area as town.",
    property_type: "SG: land only (state-owned development sites sold by tender; price per m² of gross floor area). Leave out or use land.",
    months: "SG: look-back in months from the newest award in the file (July 2016), e.g. 120. Leave out for the whole file (1993 to 2016).",
  },
  examples: [
    { params: { country: "SG", property_type: "land" } },
    { params: { country: "SG", town: "Bedok", property_type: "land" }, smoke: false },
  ],
  method:
    "Singapore land: median and 10th-90th percentile of the winning tender price per m² of gross floor area on state-land sites sold by public tender (URA Government Land Sales results), by planning area. A historic file that ends in mid-2016; winning bids, not market valuations.",
  handle: (p, ctx) => sgLandTenders({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
