// Manifest: Hong Kong VHIS standard premiums (Health Bureau, via DATA.GOV.HK). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, hkPremiums, premiumsHarvest, resolveAge, resolvePolicy, resolveSex, resolveSmoker } from "./source";

export default defineSource({
  info: INFO,
  category: "health-insurance",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (Voluntary Health Insurance Scheme, standard premiums of certified Standard Plans)",
  placeName: "Hong Kong (VHIS Standard Plans)",
  status: "live",
  paramNotes: {
    area: "HK: not used (one premium table for all of Hong Kong).",
    age_group: "HK: adult = age 40 (default), young_adult = age 21, child = age 10; or give the exact insured_age.",
    franchise: "HK: not used.",
    accident: "HK: not used.",
    model: "HK: not used.",
  },
  extraParams: {
    insured_age: z.number().int().min(0).max(99).optional().describe("HK only: the insured person's age in years (0 to 99)."),
    sex: z.enum(["male", "female"]).optional().describe("HK only: male (default) or female."),
    smoker: z.enum(["yes", "no"]).optional().describe("HK only: smoker yes or no (default no)."),
    policy_type: z.enum(["standalone", "rider"]).optional().describe("HK only: standalone (default) or rider policy."),
  },
  examples: [
    { params: { country: "HK", insured_age: "40", sex: "female" } },
    { params: { country: "HK", age_group: "child" }, smoke: false },
    { params: { country: "HK", insured_age: "65", sex: "male", smoker: "yes" }, smoke: false },
  ],
  method:
    "Hong Kong: the standard premiums per year of the Voluntary Health Insurance Scheme Standard Plans certified by the Health Bureau, as the median and 10th to 90th percentile across the certified plans for an age, sex, smoking status and policy type. Posted list premiums, not amounts paid.",
  handle: (p, ctx) =>
    hkPremiums({ insured_age: num(p.insured_age), age_group: str(p.age_group), sex: str(p.sex), smoker: str(p.smoker), policy_type: str(p.policy_type), baseUrl: ctx.baseUrl }),
  nominalCounts: false,
  harvest: () => premiumsHarvest(),
  historyKey: (p) => {
    const age = resolveAge({ insured_age: num(p.insured_age), age_group: str(p.age_group) });
    const sex = resolveSex(str(p.sex));
    const smoker = resolveSmoker(str(p.smoker));
    const policy = resolvePolicy(str(p.policy_type));
    return { area: "ALL", item: `${policy}/${sex}/${smoker}/${age.age}`, label: `Hong Kong VHIS standard premium, ${policy}, ${sex}, ${smoker === "smoker" ? "smoker" : "non-smoker"}, ${age.label}` };
  },
});
