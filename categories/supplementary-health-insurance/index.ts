// Tool: what supplementary (top-up) health cover costs per month, as published average premiums. Sources plug in by declaring category "supplementary-health-insurance".
// The tool name pricepaid_supplementary_health_insurance is public once shipped: never rename it. Approved by Simon on 29 Oct 2026 (categories/APPROVED.json).
// Answers are survey averages published by a statistics office, not a personal quote and not a price list; compulsory basic cover stays in the health-insurance tool.
import { z } from "zod";
import { defineCategory, str, num } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const CONTRACT: Record<string, string> = {
  individual: "individual", individuals: "individual", personal: "individual", single: "individual", private: "individual",
  group: "group", collective: "group", employer: "group", company: "group", "group contract": "group",
};
const k = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "supplementary-health-insurance",
  tool: "pricepaid_supplementary_health_insurance",
  restPath: "supplementary-health-insurance",
  cacheSeconds: 86400,
  title: "Supplementary health insurance premiums (published averages)",
  noun: "Supplementary health insurance premiums",
  description: (places) =>
    "Use this when a user asks what supplementary (top-up, complementary) health insurance costs per month on average, for a reference person such as someone aged 60, a single adult or a couple with children, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the average monthly premium that the official survey of insurers publishes for that profile and contract type, the survey year, a confidence label, and the official source and licence. " +
    "These are survey averages across insurers (no record count is published), not a personal quote, not a price list and not an amount one person paid. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for compulsory basic health cover, for a personal quote, or for countries that are not listed.",
  params: {
    profile: z.string().min(2).optional().describe("Reference person, see the country notes, e.g. 'age 60', 'single', 'couple', 'couple 2 children', 'lowest income'. Default: single (the survey's reference insured)."),
    contract: z.enum(["individual", "group"]).optional().describe("individual = bought by the person (default); group = employer-arranged cover."),
    year: z.number().int().min(2000).max(2100).optional().describe("Survey year (the survey is run every two years). Default: the newest."),
  },
  prepare: (p) => {
    const out: Record<string, unknown> = { ...p };
    const c = str(p.contract);
    if (c) {
      const v = CONTRACT[k(c)];
      if (!v) throw new InputError('contract must be "individual" or "group".');
      out.contract = v;
    }
    if (p.year !== undefined && p.year !== null && p.year !== "") {
      const y = num(p.year);
      if (y === undefined || !Number.isInteger(y) || y < 2000 || y > 2100) throw new InputError("year must be a whole year such as 2023.");
      out.year = y;
    }
    return out;
  },
});
