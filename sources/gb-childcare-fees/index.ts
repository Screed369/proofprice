// Manifest: England childcare fees (DfE Childcare and early years provider survey). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, gbChildcare, gbHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["GB"],
  countryHelp: "GB = England only (DfE provider survey; Scotland, Wales and Northern Ireland are not covered)",
  placeName: "England",
  status: "live",
  paramNotes: {
    area: "GB: England (leave out), a region (London, North West ...) or a local authority (Manchester, Leeds, Camden ...). Local authorities are published for 2 year olds and 3 and 4 year olds only.",
    age_group: "GB: infant (under 2), toddler (2), preschool (3 and 4; default) or school-age (regions only).",
    care_type: "GB: centre (shown as private group-based providers) or home-based (childminders); England as a whole only. Leave out for all providers.",
    hours: "GB: ignored; fees are per hour, with no full-time or part-time split.",
  },
  examples: [
    { params: { country: "GB", area: "London" } },
    { params: { country: "GB", area: "Manchester", age_group: "toddler" }, smoke: false },
    { params: { country: "GB", age_group: "infant", care_type: "home-based" }, smoke: false },
  ],
  method:
    "England childcare: the collector reads the Department for Education Childcare and early years provider survey release (Explore education statistics) each day into our price library; answers are the published median hourly fee providers charge parents, for England, a region or a local authority, by age of child and (for England) provider type, with the number of providers answering. Survey estimates, per hour, before government-funded hours.",
  handle: (p, ctx) =>
    gbChildcare({
      area: str(p.area),
      age_group: str(p.age_group),
      care_type: str(p.care_type),
      hours: str(p.hours),
      baseUrl: ctx.baseUrl,
    }),
  harvest: gbHarvest,
});
