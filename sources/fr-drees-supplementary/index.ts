// Manifest: France supplementary health insurance, DREES survey average premiums (data.drees.solidarites-sante.gouv.fr). Logic lives in ./source.ts.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, frDreesSupplementary } from "./source";

export default defineSource({
  info: INFO,
  category: "supplementary-health-insurance",
  countries: ["FR"],
  countryHelp: "FR = France (DREES survey of insurers: average monthly premium of supplementary 'mutuelle' cover, EUR, survey years 2019, 2021 and 2023)",
  placeName: "France",
  status: "live",
  paramNotes: {
    profile: "France: age 20 / 40 / 60 / 65 / 75 / 85 (individual contracts), single (default), couple, couple 1 child, couple 2 children, couple 3 children, any age (group contracts), lowest income, highest income, cheapest area, dearest area.",
    contract: "France: individual (default) or group (employer-arranged). Ages are published for individual contracts only.",
    year: "France: survey year 2019, 2021 or 2023 (default: newest).",
  },
  examples: [
    { params: { country: "FR" } },
    { params: { country: "FR", profile: "age 60", year: "2021" }, smoke: false },
  ],
  method:
    "France supplementary health insurance: the average monthly premium that the DREES survey of insurers publishes for a reference profile and contract type, passed on as published (no sample size is published).",
  handle: (p, ctx) => frDreesSupplementary({ profile: str(p.profile), contract: str(p.contract), year: num(p.year), baseUrl: ctx.baseUrl }),
});
