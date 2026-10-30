// Manifest: Australia university tuition (Commonwealth supported places, maximum student contribution per EFTSL; Department of Education indexed rates). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, auTuition } from "./source";

export default defineSource({
  info: INFO,
  category: "tuition",
  countries: ["AU"],
  countryHelp: "AU = Australia (Department of Education: maximum student contribution for Commonwealth supported university places, per full-time year, by field of education)",
  placeName: "Australia",
  status: "live",
  paramNotes: {
    cycle: "Australia: the Commonwealth supported amounts apply to bachelor's and postgraduate places alike; the answer is the same for first and second.",
    student_group: "Australia: home = domestic Commonwealth supported students (the only group published here; leave out).",
    study_mode: "Australia: amounts are per full-time year (EFTSL); full-time only.",
  },
  extraParams: {
    field: z.string().optional().describe("Australia only: field of education, e.g. law, nursing, engineering, computing, education, medicine, agriculture (or an id from extra.all_fields). Default law_commerce."),
    commenced: z.string().optional().describe("Australia only: after_2020 (started on or after 1 January 2021, the default) or before_2021 (grandfathered students)."),
    year: z.string().optional().describe("Australia only: 2026 or 2027 rates. Default is the year in force today."),
  },
  examples: [
    { params: { country: "AU" } },
    { params: { country: "AU", field: "nursing" }, smoke: false },
    { params: { country: "AU", field: "medicine", commenced: "before_2021", year: "2027" }, smoke: false },
  ],
  method:
    "Australia tuition fees: the Department of Education's published maximum student contribution for Commonwealth supported places, per full-time year (EFTSL), by field of education, in Australian dollars. " +
    "We pass on the published amount and its year; it is a statutory maximum, not payments by sampled students, with no range or sample size.",
  handle: (p, ctx) =>
    Promise.resolve(
      auTuition({
        cycle: str(p.cycle),
        student_group: str(p.student_group),
        study_mode: str(p.study_mode),
        field: str(p.field),
        commenced: str(p.commenced),
        year: str(p.year),
        baseUrl: ctx.baseUrl,
      }),
    ),
});
