// Manifest: Singapore state property rent awards (Singapore Land Authority rental tender and bidding results, data.gov.sg). Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, sgSlaRents } from "./source";

export default defineSource({
  info: INFO,
  category: "state-property-rents",
  countries: ["SG"],
  countryHelp: "SG = Singapore (Singapore Land Authority rent awards on state land and buildings, SGD a month, award years 2004 to 2025)",
  placeName: "Singapore state property",
  status: "live",
  paramNotes: {
    use: "Singapore: a word from the tendered uses, e.g. childcare, hostel, school, storage, nursery, office, commercial. At least 5 awards must match.",
    allocation: "Singapore: tender, direct (direct allocation) or auction. Leave out for all.",
    years: "Singapore: award years to include, counted back from the newest year in the file (2025). Default 10.",
  },
  examples: [
    { params: { country: "SG" } },
    { params: { country: "SG", use: "childcare", years: "15" }, smoke: false },
  ],
  method:
    "Singapore state-property rents: median and 10th-90th percentile of the monthly rent awarded for the first lease term in Singapore Land Authority tender, direct-allocation and auction results, by tendered use and award year. Contract rents from award results, not market rents.",
  handle: (p, ctx) => sgSlaRents({ use: str(p.use), allocation: str(p.allocation), years: num(p.years), baseUrl: ctx.baseUrl }),
});
