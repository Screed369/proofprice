// Tool: what a public transport journey costs under the operator's or regulator's posted fare table. Sources plug in by declaring category "transport-fares".
// The tool name pricepaid_transport_fares is public once shipped: never rename it. Approved by Simon on 29 Oct 2026 (categories/APPROVED.json).
// Answers are POSTED fares (a published tariff, the same for everyone in a fare group), never amounts paid by individuals: there is no sample size.
import { z } from "zod";
import { defineCategory, str, num } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const FARE_TYPE: Record<string, string> = {
  adult: "adult", adults: "adult", standard: "adult", regular: "adult",
  senior: "senior", seniors: "senior", "senior citizen": "senior", elderly: "senior",
  student: "student", students: "student",
  workfare: "workfare", "low income": "workfare",
  disability: "disability", disabled: "disability", pwd: "disability", "persons with disabilities": "disability",
};
const WHEN: Record<string, string> = {
  early: "early", "before 7.45": "early", "before 745": "early", "pre-peak": "early", "pre peak": "early",
  other: "other", normal: "other", standard: "other", "all other": "other", peak: "other",
};
const k = (s: string) => s.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "transport-fares",
  tool: "pricepaid_transport_fares",
  restPath: "transport-fares",
  cacheSeconds: 86400,
  title: "Public transport fares (posted fare tables)",
  noun: "Public transport fares",
  description: (places) =>
    "Use this when a user asks what a public transport journey costs under the published fare table, for example a metro ride of a given distance for an adult, senior or student, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the posted fare for the journey with the fare group, distance band and time band, the period, and the official source and licence. " +
    "These are posted fares set by the operator or regulator, the same for everyone in a fare group, not amounts paid by individuals and not a ticket or a quote; there is no sample size and no range. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for taxis or ride-hailing, flights, fuel, a personal quote or passes, or for countries that are not listed.",
  params: {
    fare_type: z.enum(["adult", "senior", "student", "workfare", "disability"]).optional().describe("Fare group (default adult). The groups available depend on the country notes."),
    distance_km: z.number().min(0).optional().describe("Journey distance in kilometres (default 5). The fare is looked up in the published distance band."),
    travel_time: z.enum(["early", "other"]).optional().describe("early = the discounted band before the morning peak where a country has one; other = all other times (default)."),
  },
  prepare: (p) => {
    const out: Record<string, unknown> = { ...p };
    const ft = str(p.fare_type);
    if (ft) {
      const v = FARE_TYPE[k(ft)];
      if (!v) throw new InputError("fare_type must be adult, senior, student, workfare or disability.");
      out.fare_type = v;
    }
    const tt = str(p.travel_time);
    if (tt) {
      const v = WHEN[k(tt)];
      if (!v) throw new InputError('travel_time must be "early" or "other".');
      out.travel_time = v;
    }
    if (p.distance_km !== undefined && p.distance_km !== null && p.distance_km !== "") {
      const d = num(p.distance_km);
      if (d === undefined || d < 0 || d > 500) throw new InputError("distance_km must be a number of kilometres between 0 and 500, e.g. 8.5.");
      out.distance_km = d;
    }
    return out;
  },
});
