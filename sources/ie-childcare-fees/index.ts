// Manifest: Ireland childcare costs (CSO table CCA12, 2016, regional). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ieChildcare } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["IE"],
  countryHelp: "IE = Ireland (CSO survey of what households pay for childcare, 2016, by region)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    area: "IE: a county, city or region such as Dublin, Cork, Galway or Mid-West; the answer is for the CSO region it belongs to. Leave out for the whole State.",
    age_group: "IE: only 'pre-school' (infant, toddler and preschool all give the pre-school children figure) or school-age (primary school children); leave out for all children aged 0 to 12.",
    care_type: "IE: ignored; the table averages all paid childcare.",
    hours: "IE: ignored; the table averages part-time and full-time use.",
  },
  examples: [
    { params: { country: "IE", area: "Dublin" } },
    { params: { country: "IE", area: "County Cork", age_group: "school-age" }, smoke: false },
  ],
  method:
    "Ireland childcare: each request reads the Central Statistics Office table CCA12 (Cost of Childcare, QNHS childcare module, 2016) and passes on the published average weekly cost of paid childcare that households in the chosen region report, for pre-school children, primary school children or all children aged 0 to 12. Household-reported, regional, and ten years old; not the Pobal provider-fee survey.",
  handle: (p, ctx) =>
    ieChildcare({
      area: str(p.area),
      age_group: str(p.age_group),
      care_type: str(p.care_type),
      hours: str(p.hours),
      baseUrl: ctx.baseUrl,
    }),
});
