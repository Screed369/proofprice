// Tool: what universities and colleges charge students per year (statutory / published fees). Sources plug in by declaring category "tuition".
// The tool name pricepaid_tuition_fees is public once shipped: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const CYCLE: Record<string, "first" | "second"> = {
  first: "first", "first cycle": "first", bachelor: "first", bachelors: "first", undergraduate: "first", ba: "first", bsc: "first",
  second: "second", "second cycle": "second", master: "second", masters: "second", postgraduate: "second", ma: "second", msc: "second",
};
const GROUP: Record<string, "home" | "international" | "non-state-subsidised" | "specific-discipline" | "foreign-language"> = {
  home: "home", domestic: "home", national: "home", local: "home", eu: "home",
  international: "international", foreign: "international", "non-eu": "international", "non eu": "international", "third-country": "international",
  "non-state-subsidised": "non-state-subsidised", "non state subsidised": "non-state-subsidised", "self-financed": "non-state-subsidised", "fee-paying": "non-state-subsidised",
  "specific-discipline": "specific-discipline", "specific discipline": "specific-discipline", discipline: "specific-discipline",
  "foreign-language": "foreign-language", "foreign language": "foreign-language", "english-taught": "foreign-language", "english taught": "foreign-language",
};
const MODE: Record<string, "full-time" | "part-time"> = {
  "full-time": "full-time", "full time": "full-time", fulltime: "full-time", full: "full-time",
  "part-time": "part-time", "part time": "part-time", parttime: "part-time", part: "part-time",
};
const key = (s: string) => s.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "tuition",
  tool: "pricepaid_tuition_fees",
  restPath: "tuition",
  cacheSeconds: 86400,
  title: "University tuition fees",
  noun: "University tuition fees",
  description: (places) =>
    "Use this when a user asks what a university or college charges students per year (tuition or registration fees for a bachelor's or master's degree) " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, or how fees compare between countries or between home and international students. ` +
    "Returns the official statutory fee levels published for a country and academic year: the most common annual fee, the minimum and the maximum, in national currency with a euro equivalent. " +
    "These are posted fee levels set by law or by universities, not what any one student paid and not a range built from sales: there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Fees are before grants, loans and fee waivers. Do not use for the price of one named course or university, living costs or rent, school fees, or countries that are not listed.",
  params: {
    cycle: z.enum(["first", "second"]).optional().describe("Degree level: first = bachelor's (first cycle, the default), second = master's (second cycle). Also accepts bachelor, master, undergraduate, postgraduate."),
    student_group: z.enum(["home", "international", "non-state-subsidised", "specific-discipline", "foreign-language"]).optional().describe("Who pays: home (nationals and EU students who pay home fees, the default), international (students from outside the EU/EEA), non-state-subsidised (self-financed places), specific-discipline (for example medicine), foreign-language (courses taught in another language)."),
    study_mode: z.enum(["full-time", "part-time"]).optional().describe("full-time (the default) or part-time."),
  },
  prepare: (p) => {
    const out = { ...p };
    const cyc = str(p.cycle);
    if (cyc !== undefined) {
      const c = CYCLE[key(cyc)];
      if (!c) throw new InputError('cycle must be "first" (bachelor) or "second" (master).');
      out.cycle = c;
    }
    const grp = str(p.student_group);
    if (grp !== undefined) {
      const g = GROUP[key(grp)];
      if (!g) throw new InputError('student_group must be "home", "international", "non-state-subsidised", "specific-discipline" or "foreign-language".');
      out.student_group = g;
    }
    const mode = str(p.study_mode);
    if (mode !== undefined) {
      const m = MODE[key(mode)];
      if (!m) throw new InputError('study_mode must be "full-time" or "part-time".');
      out.study_mode = m;
    }
    return out;
  },
});
