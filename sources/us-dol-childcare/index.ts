// Manifest: US county childcare prices (Department of Labor, National Database of Childcare Prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, usChildcare, usHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["US"],
  countryHelp: "US = United States (Department of Labor county childcare prices, 2022)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    area: "US: required. A county, for example 'Cook County, IL' or 'Harris County, Texas' (add the state when the name is not unique). Cities, ZIP codes and states are not published; use the county.",
    age_group: "US: infant (under 2), toddler (2), preschool (3 years old to school age) or school-age. Default infant.",
    care_type: "US: centre (child care centre; default) or home-based (family childcare in the provider's home; also written childminder).",
    hours: "US: full-time only (weekly prices); part-time is not published.",
  },
  examples: [
    { params: { country: "US", area: "Cook County, IL", age_group: "infant" } },
    { params: { country: "US", area: "Harris County, TX", age_group: "preschool", care_type: "home-based" }, smoke: false },
  ],
  method:
    "United States childcare: the collector streams the Department of Labor Women's Bureau National Database of Childcare Prices workbook each day into our price library; answers are the published median weekly price of full-time care charged to parents for the chosen county, age of child and setting, for the latest year in the database (2022). An official median, not a range of individual bills; the database lags by several years.",
  handle: (p, ctx) =>
    usChildcare({
      area: str(p.area),
      age_group: str(p.age_group),
      care_type: str(p.care_type),
      hours: str(p.hours),
      baseUrl: ctx.baseUrl,
    }),
  harvest: usHarvest,
});
