// Manifest: Denmark childcare rates (posted municipal yearly rates, Statistics Denmark RES88). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { dkChildcare, dkChildcareHarvest, dkChildcareHistoryKey, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["DK"],
  countryHelp: "DK = Denmark (Statistics Denmark posted yearly parental rates for day-care, by municipality; DKK per year, before family reductions)",
  placeName: "Denmark",
  status: "live",
  paramNotes: {
    area: "DK: a municipality such as Copenhagen (København), Aarhus, Odense, Aalborg, Frederiksberg or Esbjerg (æ ø å optional). Leave out for All Denmark (the national average of the municipal rates).",
    age_group: "DK: infant or toddler = age 0-2 (nursery, default); preschool = age 3-5 (kindergarten); school-age = age 6-9 (school-care scheme, SFO).",
    care_type: "DK: centre (default) = nursery, kindergarten or SFO; home-based (childminder) = municipal day-care in a childminder's home with lunch, for age 0-2 or 3-5 only. Some cells are suppressed for big cities.",
    hours: "DK: ignored; the rates are for a full-time place.",
  },
  examples: [
    { params: { country: "DK", area: "Copenhagen" } },
    { params: { country: "DK" }, smoke: false },
    { params: { country: "DK", area: "Aarhus", age_group: "preschool" }, smoke: false },
  ],
  method:
    "Denmark childcare: each request reads Statistics Denmark's StatBank table RES88 (Takster for børnepasning) and passes on the published yearly parental rate, in DKK per child place per year, for the chosen municipality (or All Denmark) and arrangement (nursery 0-2, kindergarten 3-5, school-care 6-9, or a childminder's home), with its year. " +
    "A posted municipal rate for a full-time place, before sibling and income-based reductions, not a price range and not what each family paid.",
  handle: (p, ctx) => dkChildcare({ area: str(p.area), age_group: str(p.age_group), care_type: str(p.care_type), baseUrl: ctx.baseUrl }),
  harvest: () => dkChildcareHarvest(),
  historyKey: (p) => dkChildcareHistoryKey({ area: str(p.area), age_group: str(p.age_group), care_type: str(p.care_type) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Denmark: Statistics Denmark publishes one posted rate per municipality and year, and ProofPrice keeps no separate history of it yet. Ask pricepaid_childcare_prices for the newest year, which carries the previous year and its change.",
});
