// Manifest: European university tuition fees (Eurydice open data workbook). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { COUNTRY, INFO, euTuition } from "./source";

export default defineSource({
  info: INFO,
  category: "tuition",
  countries: Object.keys(COUNTRY),
  countryHelp: "European countries as ISO codes (GR for Greece): " + Object.entries(COUNTRY).map(([c, v]) => `${c} = ${v.name}`).join(", "),
  placeName: "Europe",
  status: "live",
  paramNotes: {
    cycle: "Europe, Eurydice: first = bachelor's (default), second = master's.",
    student_group: "Europe, Eurydice: home (default), international (non-EU/EEA), non-state-subsidised, specific-discipline, foreign-language. Not every group exists in every country: the answer says when a fee is not available.",
    study_mode: "Europe, Eurydice: full-time (default) or part-time.",
  },
  extraParams: {
    community: z.string().optional().describe("BE only: the higher-education system, because Belgium has three with different fees: fr (French Community), nl (Flemish Community) or de (German-speaking Community)."),
  },
  examples: [
    { params: { country: "IE" } },
    { params: { country: "DE", cycle: "second" }, smoke: false },
    { params: { country: "BE", community: "nl" }, smoke: false },
  ],
  method:
    "Europe tuition fees: the Eurydice (European Commission) open-data workbook gives, per country and academic year, the most common, minimum and maximum annual tuition fee of public higher education by degree cycle, student category and study mode, in national currency. We pass on those posted fee levels with a euro equivalent; they are not what students paid and carry no sample size.",
  handle: (p, ctx) =>
    euTuition({
      country: String(p.country),
      cycle: str(p.cycle),
      student_group: str(p.student_group),
      study_mode: str(p.study_mode),
      community: str(p.community),
      baseUrl: ctx.baseUrl,
    }),
});
