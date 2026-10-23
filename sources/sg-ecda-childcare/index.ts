// Manifest: Singapore childcare centre fees (ECDA Listing of Centre Services on data.gov.sg). Logic lives in ./source.ts.
// The daily collector (harvest) pages through the dataset; requests are answered from the price library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, ecdaChildcare, ecdaHarvest, ecdaHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "childcare",
  countries: ["SG"],
  countryHelp: "SG = Singapore (monthly full-day fees that licensed childcare centres list with ECDA)",
  placeName: "Singapore childcare centres",
  status: "live",
  paramNotes: {
    area: "SG: not available (the listing has no location); leave out for the national figure across all centres.",
    age_group: "SG: infant (2 to 18 months), toddler (playgroup, 18 months to 2 years) or preschool (Pre-Nursery and Nursery, 3 to 4 years; the default). school-age is not in the listing.",
    care_type: "SG: centre only (licensed childcare centres); home-based answers 400.",
    hours: "SG: full-time only (full-day fees); part-time answers 400.",
  },
  extraParams: {
    level: z.string().optional().describe("SG only: one level instead of age_group: Infant, Playgroup, Pre-Nursery, Nursery, Kindergarten 1 or Kindergarten 2."),
    citizenship: z.string().optional().describe("SG only: the fee group: SC (Singapore citizen, the default), SPR (permanent resident) or Others (foreign families). Centres list different fees for each; the answer also shows the other groups."),
  },
  examples: [
    { params: { country: "SG", age_group: "infant" } },
    { params: { country: "SG", level: "Kindergarten 2", citizenship: "SPR" }, smoke: false },
  ],
  method:
    "Singapore childcare: the Early Childhood Development Agency's Listing of Centre Services (data.gov.sg), collected once a day into our price library; an answer is the median and 10th to 90th percentile, across licensed centres, of the monthly full-day fee each centre lists for a level and citizenship group, in Singapore dollars. Posted fees before government subsidies, not what parents paid.",
  handle: (p, ctx) =>
    ecdaChildcare({
      age_group: str(p.age_group), level: str(p.level), citizenship: str(p.citizenship),
      care_type: str(p.care_type), hours: str(p.hours), area: str(p.area), baseUrl: ctx.baseUrl,
    }),
  harvest: ecdaHarvest,
  historyKey: (p) =>
    ecdaHistoryKey({ age_group: str(p.age_group), level: str(p.level), citizenship: str(p.citizenship), care_type: str(p.care_type), hours: str(p.hours), area: str(p.area) }),
});
