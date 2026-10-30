// Tool: what public buyers actually paid, from official contract award notices. Sources plug in by declaring category "contracts".
// The tool name pricepaid_contract_prices is public: never rename it.
import { z } from "zod";
import { defineCategory, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "contracts",
  tool: "pricepaid_contract_prices",
  restPath: "contracts",
  cacheSeconds: 21600,
  title: "Government contract prices (what public buyers paid)",
  noun: "Government contract prices",
  description: (places) =>
    "Use this when a user asks what governments, councils, hospitals or other public buyers actually paid for something " +
    "(laptops, school meals, road resurfacing, office cleaning, electricity, ambulances, waste collection and similar purchases) " +
    `in ${joinOr(places.map((p) => p.place))}. Returns, from official contract award notices, the median awarded value per contract, ` +
    "a typical range (10th–90th percentile), the number of awards, the period covered, a confidence label, and the official source and licence. " +
    "Important: the figures are TOTAL values per contract (lot), not unit prices, unless the answer states a unit price (only when the notices give a quantity and unit). " +
    "Nothing is returned for fewer than 5 awards, and individual suppliers are never named. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for what consumers or private companies pay, for tenders that are still open (those carry estimates, not prices paid), " +
    "for the contracts of one named supplier, for asking prices, or for other countries.",
  params: {
    what: z
      .string()
      .min(2)
      .describe(
        "What was bought, in plain words: 'laptops', 'school meals', 'road resurfacing', 'office cleaning', 'electricity', 'ambulances', 'waste collection'. " +
          "Common purchases are matched to official product codes; anything else is searched as free text in the award notices.",
      ),
    cpv: z
      .string()
      .optional()
      .describe("Optional official product code, to be exact, where the source uses one (the country notes say which code system), e.g. the CPV code 30213100 for portable computers; a prefix such as 3021 covers the whole group."),
    buyer_area: z
      .string()
      .optional()
      .describe("Optional region or city to narrow to, see the country notes below."),
    months: z.number().int().min(1).max(60).optional().describe("How many recent months of awards to include. Default 24."),
  },
  required: ["what"],
  prepare: (p) => {
    let what = (str(p.what) ?? "").replace(/\s+/g, " ").trim();
    // New Zealand, and Canada asked for Alberta (whose sole-source list supports what=all), answer a bare question with all awards
    // (the source says so in its answer); other countries need a purchase.
    const country = String(p.country ?? "").toUpperCase();
    const whatDefaulted = what.length === 0 && !str(p.cpv) && (country === "NZ" || (country === "CA" && /alberta/i.test(str(p.buyer_area) ?? "")));
    if (whatDefaulted) what = "all";
    if (what.length < 2) {
      const esHint = country === "ES" ? " For Spain, try /api/v1/contracts?country=ES&what=office%20cleaning, or a CPV division such as cpv=45 (construction) with any what." : "";
      throw new InputError("what is required: say what was bought, for example 'laptops', 'school meals' or 'road resurfacing'." + esHint);
    }
    const months = Math.round(num(p.months) ?? 24);
    if (!(months >= 1 && months <= 60)) throw new InputError("months must be between 1 and 60.");
    return { ...p, what, months, cpv: str(p.cpv), buyer_area: str(p.buyer_area), ...(whatDefaulted ? { what_defaulted: true } : {}) };
  },
});
