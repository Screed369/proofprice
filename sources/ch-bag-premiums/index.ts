// Manifest: Swiss compulsory health insurance premiums (BAG approved tariffs). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { CANTONS, INFO, chPremiums, premiumsHarvest, resolveCanton } from "./source";

export default defineSource({
  info: INFO,
  category: "health-insurance",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (compulsory basic health insurance)",
  placeName: "Switzerland",
  status: "live",
  paramNotes: {
    area: `CH: a canton code (${CANTONS.join(", ")}); leave out for all of Switzerland. Premium regions inside a canton are pooled.`,
    franchise: "CH: adults and young adults 300, 500, 1000, 1500, 2000 or 2500 CHF; children 0, 100, 200, 300, 400, 500 or 600 CHF.",
  },
  examples: [
    { params: { country: "CH", area: "ZH" } },
    { params: { country: "CH", area: "GE", age_group: "adult", franchise: "2500" }, smoke: false },
    { params: { country: "CH", area: "BE", age_group: "child" }, smoke: false },
  ],
  method:
    "Switzerland: the monthly premiums of compulsory basic health insurance approved by the Federal Office of Public Health for the next year, as the median and 10th to 90th percentile across all insurer tariffs in a canton for an age group, deductible and model. Posted list premiums, not amounts paid.",
  handle: (p, ctx) =>
    chPremiums({ area: str(p.area), age_group: str(p.age_group), franchise: num(p.franchise), accident: str(p.accident), model: str(p.model), baseUrl: ctx.baseUrl }),
  nominalCounts: false,
  harvest: premiumsHarvest,
  historyKey: (p) => {
    const age = str(p.age_group) ?? "adult";
    const acc = str(p.accident) ?? (age === "child" ? "with" : "without");
    const fr = num(p.franchise) ?? (age === "child" ? 0 : 300);
    return { area: resolveCanton(str(p.area)), item: `${age}/${acc}/${fr}/${str(p.model) ?? "standard"}`, label: `Swiss basic health insurance, ${age}` };
  },
});
