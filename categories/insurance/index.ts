// Tool: what insurance policies cost the people who hold them. Sources plug in by declaring category "insurance" in their manifest.
// The tool name pricepaid_insurance_prices is public: never rename it.
// Answers are built from real policy charges (aggregates only, never one policy): see each source's method text.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "insurance",
  tool: "pricepaid_insurance_prices",
  restPath: "insurance",
  cacheSeconds: 86400,
  title: "Insurance premiums paid",
  noun: "Insurance premiums",
  description: (places) =>
    "Use this when a user asks what insurance actually costs the people who hold it, for example what homeowners pay per year for flood insurance in a ZIP code or state, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the median yearly charge with the typical range (10th to 90th percentile) across real policies, the number of policies behind it, the period, a confidence label, and the official source and licence. " +
    "Only aggregates are returned, never one policy, and never fewer than 5 policies. Read the method in the answer: some premiums are set partly by public rules, so they are real charges but not a free-market quote. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for a personal quote, for insurance that is not covered by a source here, for the value or replacement cost of a home, or for other countries.",
  params: {
    area: z.string().min(2).optional().describe("Place: a 5-digit ZIP code or a state code, depending on the country notes (examples: '32935', 'TX'). Required."),
  },
  required: ["area"],
  prepare: (p) => {
    const area = (str(p.area) ?? "").trim();
    if (!area) throw new InputError("area is required: a 5-digit ZIP code such as '32935' or a state code such as 'TX'.");
    return { ...p, area };
  },
});
