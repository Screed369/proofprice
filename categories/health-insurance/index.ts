// Tool: what basic (compulsory) health insurance costs per month under published, approved tariffs. Sources plug in by declaring category "health-insurance".
// The tool name pricepaid_health_insurance_premiums is public once shipped: never rename it.
// Answers are posted tariffs approved by the regulator (the same list price for everyone in a region), not amounts paid by individuals.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const AGE: Record<string, string> = {
  adult: "adult", adults: "adult", erwachsene: "adult", "26+": "adult",
  young_adult: "young_adult", "young adult": "young_adult", "young-adult": "young_adult", young: "young_adult", "19-25": "young_adult", youth: "young_adult",
  child: "child", children: "child", kid: "child", kids: "child", minor: "child",
};
const ACCIDENT: Record<string, string> = { with: "with", yes: "with", true: "with", included: "with", without: "without", no: "without", false: "without", excluded: "without" };
const MODEL: Record<string, string> = {
  standard: "standard", basic: "standard", base: "standard", ordinary: "standard", free: "standard",
  alternative: "alternative", managed: "alternative", gatekeeper: "alternative", hmo: "alternative", "family doctor": "alternative", telmed: "alternative",
};
const k = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "health-insurance",
  tool: "pricepaid_health_insurance_premiums",
  restPath: "health-insurance",
  cacheSeconds: 86400,
  title: "Health insurance premiums (approved tariffs)",
  noun: "Health insurance premiums",
  description: (places) =>
    "Use this when a user asks what compulsory basic health insurance costs per month under the approved tariffs, for example for an adult in a region with a given deductible, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the median monthly premium with the typical range (10th to 90th percentile) across the insurers' approved tariffs, the number of tariffs behind it, the period, a confidence label, and the official source and licence. " +
    "These are posted list tariffs approved by the regulator, the same for everyone in a region and age group, not amounts paid by individuals and not a personal quote. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for a personal quote, for supplementary or private cover, or for countries not listed.",
  params: {
    area: z.string().min(2).optional().describe("Region (see the country notes), e.g. a canton code such as 'ZH'. Leave out for the whole country."),
    age_group: z.enum(["adult", "young_adult", "child"]).optional().describe("Age group: adult (26+, default), young_adult (19-25) or child (0-18)."),
    franchise: z.number().int().min(0).optional().describe("Annual deductible in local currency; the values available depend on the country notes. Default: the lowest one for the age group."),
    accident: z.enum(["with", "without"]).optional().describe("Whether accident cover is included in the premium. Default: without for adults and young adults, with for children."),
    model: z.enum(["standard", "alternative"]).optional().describe("standard = free choice of doctor (default); alternative = family-doctor, telemedicine or HMO models with a restricted choice."),
  },
  prepare: (p) => {
    const out: Record<string, unknown> = { ...p };
    const area = str(p.area);
    if (area) out.area = area.toUpperCase();
    const age = str(p.age_group);
    if (age) {
      const a = AGE[k(age)];
      if (!a) throw new InputError("age_group must be adult, young_adult or child.");
      out.age_group = a;
    }
    const acc = str(p.accident);
    if (acc) {
      const a = ACCIDENT[k(acc)];
      if (!a) throw new InputError("accident must be 'with' or 'without'.");
      out.accident = a;
    }
    const mod = str(p.model);
    if (mod) {
      const m = MODEL[k(mod)];
      if (!m) throw new InputError("model must be 'standard' or 'alternative'.");
      out.model = m;
    }
    if (p.franchise !== undefined && p.franchise !== null && p.franchise !== "") {
      const f = Number(p.franchise);
      if (!Number.isInteger(f) || f < 0) throw new InputError("franchise must be a whole number (the annual deductible in local currency), e.g. 300 or 2500.");
      out.franchise = f;
    }
    return out;
  },
});
