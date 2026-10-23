// Manifest: Canada childcare fees (Statistics Canada table 42-10-0071-01, April 2024, by province and age group). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, caChildcare, caChildcareHarvest, childcareHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["CA"],
  countryHelp: "CA = Canada (Statistics Canada average daily fee of centre-based child care, April 2024, by province and age group)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    area: "CA: a province or territory (Ontario, Quebec, BC, Alberta ...). Required: there is no national or city figure.",
    age_group: "CA: infant, toddler, preschool (the default) or school-age; each province's own age groups are matched to these by their stated ages.",
    care_type: "CA: centre only (the default); home-based care is not published.",
    hours: "CA: ignored; the table gives one daily fee.",
  },
  examples: [
    { params: { country: "CA", area: "Ontario" } },
    { params: { country: "CA", area: "Quebec", age_group: "infant" }, smoke: false },
  ],
  method:
    "Canada childcare: Statistics Canada's average daily fee charged by centre-based child care providers in April 2024 (table 42-10-0071-01), by province or territory and age group of the child. " +
    "Posted fees before subsidies, with no range or sample size; provinces' own age groups are matched to infant, toddler, preschool and school-age.",
  handle: (p, ctx) =>
    caChildcare({ area: str(p.area), age_group: str(p.age_group), care_type: str(p.care_type), hours: str(p.hours), baseUrl: ctx.baseUrl }),
  harvest: () => caChildcareHarvest(),
  historyKey: (p) => childcareHistoryKey({ area: str(p.area), age_group: str(p.age_group) }),
  referenceDates: true,
  nominalCounts: true,
});
