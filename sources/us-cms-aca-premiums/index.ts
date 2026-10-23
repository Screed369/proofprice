// Manifest: US ACA marketplace health insurance premiums (CMS Exchange public use files, HealthCare.gov states). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, premiumsHarvest, resolveAge, resolveMetal, resolveState, usPremiums } from "./source";

export default defineSource({
  info: INFO,
  category: "health-insurance",
  countries: ["US"],
  countryHelp: "US = United States (ACA marketplace plans, HealthCare.gov states)",
  placeName: "United States marketplace plans",
  status: "live",
  paramNotes: {
    area: "US: a two-letter state code on HealthCare.gov (for example TX, FL, GA); leave out for all those states together. Rating areas inside a state are pooled.",
    age_group: "US: adult = age 40 (default), young_adult = age 21, child = 0-14; or give the exact age.",
    franchise: "US: not used (marketplace plans are compared by metal level, not by deductible).",
    accident: "US: not used.",
    model: "US: not used.",
  },
  extraParams: {
    age: z.number().int().min(0).max(120).optional().describe("US only: the person's age in years (18 to 63 give their own rate; 64 and over share one; 0-14 share the child rate)."),
    metal_level: z.enum(["bronze", "silver", "gold", "platinum", "catastrophic"]).optional().describe("US only: marketplace metal level. Default silver."),
  },
  examples: [
    { params: { country: "US", area: "TX", metal_level: "silver", age: "40" } },
    { params: { country: "US", metal_level: "bronze", age: "27" }, smoke: false },
    { params: { country: "US", area: "FL", metal_level: "gold", age_group: "young_adult" }, smoke: false },
  ],
  method:
    "United States: the listed monthly premiums, before tax credits, of individual-market medical plans on HealthCare.gov from the CMS Exchange public use files, as the median and 10th to 90th percentile across plan offers in a state for a metal level and age. Posted list prices, not amounts paid.",
  handle: (p, ctx) =>
    usPremiums({ area: str(p.area), age: num(p.age), age_group: str(p.age_group), metal_level: str(p.metal_level), baseUrl: ctx.baseUrl }),
  nominalCounts: false,
  harvest: premiumsHarvest,
  historyKey: (p) => {
    const age = resolveAge({ age: num(p.age), age_group: str(p.age_group) });
    const metal = resolveMetal(str(p.metal_level));
    return { area: resolveState(str(p.area)), item: `${metal}/${age.key}`, label: `US marketplace ${metal} plan premium, ${age.label}` };
  },
});
