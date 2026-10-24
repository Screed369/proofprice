// Manifest: Qatar home sales (registered sales, National Planning Council, Qatar Open Data). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, MUNICIPALITY_LIST, qaHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["QA"],
  countryHelp: "QA = Qatar (villas, houses and residential buildings; registered sales; the bulletin's newest sale is Dec 2025)",
  placeName: "Qatar",
  status: "live",
  paramNotes: {
    town: `QA: a municipality (${MUNICIPALITY_LIST.join(", ")}) or a district name; leave out for all of Qatar.`,
    property_type: "QA: any (default), villa (villas and houses) or building (whole residential buildings).",
    months: "QA: 1 to 36 months back from the newest sale in the bulletin (not from today).",
  },
  paramValues: { property_type: ["villa", "building"] },
  examples: [{ params: { country: "QA", town: "Doha" } }, { params: { country: "QA" }, smoke: false }],
  method:
    "Qatar: median and 10th–90th percentile of registered sale values of villas, houses and residential buildings (QAR, whole plot) in the months before the newest sale in the National Planning Council's sales bulletin (newest sale: Dec 2025); never plots or owners.",
  handle: (p, ctx) => qaHomeSales({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
