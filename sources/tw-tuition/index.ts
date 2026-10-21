// Manifest: Taiwan college and university tuition fee standards (Ministry of Education, data.gov.tw 24726). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, twTuition, FACULTIES } from "./source";

export default defineSource({
  info: INFO,
  category: "tuition",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Ministry of Education: posted tuition and miscellaneous fee standards per semester, bachelor's day programmes, by faculty group)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    cycle: "Taiwan: first = bachelor's (the only level in the file).",
    student_group: "Taiwan: one fee standard per institution; home is the only group.",
    study_mode: "Taiwan: full-time day programmes only (the default).",
  },
  extraParams: {
    faculty: z.string().optional().describe(`Taiwan only: faculty group (${FACULTIES.join(", ")}). Default humanities_law. Words like law, business, engineering, medicine, nursing also work.`),
    ownership: z.string().optional().describe("Taiwan only: public or private institutions (default both)."),
    school_type: z.string().optional().describe("Taiwan only: university (general universities) or technical (technical and vocational colleges); default both."),
  },
  examples: [
    { params: { country: "TW" } },
    { params: { country: "TW", faculty: "engineering", ownership: "private" }, smoke: false },
    { params: { country: "TW", faculty: "medicine", school_type: "university" }, smoke: false },
  ],
  method:
    "Taiwan tuition: the Ministry of Education's posted fee standards (tuition plus miscellaneous fees, per semester) for day-programme bachelor's degrees, newest academic year. " +
    "Median and 10th to 90th percentile across the institutions that offer the chosen faculty group, each counted once; posted fees, not amounts students paid.",
  handle: (p, ctx) =>
    twTuition({
      cycle: str(p.cycle),
      student_group: str(p.student_group),
      study_mode: str(p.study_mode),
      faculty: str(p.faculty),
      ownership: str(p.ownership),
      school_type: str(p.school_type),
      baseUrl: ctx.baseUrl,
    }),
});
