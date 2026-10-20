// Manifest: Canada university tuition fees (Statistics Canada table 37-10-0045-01). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, caTuition } from "./source";

export default defineSource({
  info: INFO,
  category: "tuition",
  countries: ["CA"],
  countryHelp: "CA = Canada (Statistics Canada: average posted tuition fees of publicly funded universities, by province, Canadian or international students, undergraduate or graduate)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    cycle: "Canada, Statistics Canada: first = undergraduate (default), second = graduate (master's and doctorate).",
    student_group: "Canada, Statistics Canada: home = Canadian citizens and permanent residents (default) or international. Other groups are not published.",
    study_mode: "Canada: full-time only (the default).",
  },
  extraParams: {
    province: z.string().optional().describe("Canada only: a province (Ontario, Quebec, BC, Alberta ...) or leave out for the Canada average. Yukon is mostly not published; the other territories are not in the table."),
  },
  examples: [
    { params: { country: "CA" } },
    { params: { country: "CA", province: "Ontario", student_group: "international" }, smoke: false },
    { params: { country: "CA", cycle: "second", province: "Quebec" }, smoke: false },
  ],
  method:
    "Canada tuition fees: Statistics Canada's weighted average of published tuition fees for full-time students at publicly funded degree-granting institutions (table 37-10-0045-01), by province and level of study, in current Canadian dollars per academic year. " +
    "We pass on the published average and its academic year; it is posted fees, not payments by sampled students, with no range or sample size.",
  handle: (p, ctx) =>
    caTuition({
      cycle: str(p.cycle),
      student_group: str(p.student_group),
      study_mode: str(p.study_mode),
      province: str(p.province),
      baseUrl: ctx.baseUrl,
    }),
});
