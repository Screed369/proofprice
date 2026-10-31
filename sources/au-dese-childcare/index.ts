// Manifest: Australia childcare fees (Department of Education, Child Care Subsidy data report, average hourly fee). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, auChildcare, auHarvest, auHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["AU"],
  countryHelp: "AU = Australia (Department of Education, Child Care Subsidy data report: average hourly fee, latest quarter, by state or care type)",
  placeName: "Australia",
  status: "live",
  paramNotes: {
    area: "AU: a state or territory (NSW, Victoria, Queensland, SA, WA, Tasmania, NT, ACT) or leave out for Australia. State figures cover all care types together; no city figures.",
    care_type: "AU: centre (centre based day care) or home-based (family day care), national figure only; leave out for all care types.",
    age_group: "AU: no figure by child age; school-age is answered with outside school hours care, other values are ignored.",
    hours: "AU: ignored; the figure is per hour.",
  },
  examples: [
    { params: { country: "AU", area: "NSW" } },
    { params: { country: "AU", care_type: "centre" }, smoke: false },
    { params: { country: "AU", age_group: "school-age" }, smoke: false },
  ],
  method:
    "Australia childcare: the average hourly fee for the latest quarter in the Department of Education's Child Care Subsidy data report, by state or territory or by care type. " +
    "A published average with no range or sample size; the report does not say whether it is before the subsidy.",
  handle: (p, ctx) => auChildcare({ area: str(p.area), care_type: str(p.care_type), age_group: str(p.age_group), baseUrl: ctx.baseUrl }),
  harvest: () => auHarvest(),
  historyKey: (p) => auHistoryKey({ area: str(p.area), care_type: str(p.care_type), age_group: str(p.age_group) }),
  referenceDates: true,
  nominalCounts: true,
});
