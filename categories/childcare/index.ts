// Tool: what childcare costs parents. Sources plug in by declaring category "childcare" in their manifest.
// The tool name pricepaid_childcare_prices is public: never rename it.
// These are official surveys and statistics of the fees providers charge parents (or, where a source says so, what households
// report paying), never the adverts or listings of nurseries. Fees are before public subsidies unless a source states otherwise.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const AGE_ALIASES: Record<string, "infant" | "toddler" | "preschool" | "school-age"> = {
  infant: "infant", infants: "infant", baby: "infant", babies: "infant", "under 2": "infant", "under-2": "infant", "under2": "infant",
  toddler: "toddler", toddlers: "toddler", "2": "toddler", "2 year old": "toddler", "two year old": "toddler",
  preschool: "preschool", "pre-school": "preschool", "pre school": "preschool", preschooler: "preschool", "3-4": "preschool", "3 and 4": "preschool",
  "school-age": "school-age", "school age": "school-age", schoolage: "school-age", school: "school-age", "after school": "school-age", "after-school": "school-age",
};

const CARE_ALIASES: Record<string, "centre" | "home-based"> = {
  centre: "centre", center: "centre", "centre-based": "centre", "center-based": "centre", nursery: "centre", "day nursery": "centre", group: "centre", "group-based": "centre",
  "home-based": "home-based", "home based": "home-based", home: "home-based", childminder: "home-based", childminders: "home-based",
  "family childcare": "home-based", "family child care": "home-based", "family": "home-based",
};

const HOURS_ALIASES: Record<string, "full-time" | "part-time"> = {
  "full-time": "full-time", "full time": "full-time", fulltime: "full-time", full: "full-time",
  "part-time": "part-time", "part time": "part-time", parttime: "part-time", part: "part-time", sessional: "part-time",
};

const key = (s: string) => s.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "childcare",
  tool: "pricepaid_childcare_prices",
  restPath: "childcare",
  cacheSeconds: 86400,
  title: "Childcare prices paid",
  noun: "Childcare prices",
  description: (places) =>
    "Use this when a user asks what childcare costs parents: the price of a nursery, daycare, childminder or after-school place for a baby, toddler, preschool or school-age child in a county, region, state or city, " +
    `or how childcare prices compare, in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "These are official surveys and statistics of the fees providers charge parents (or what households report paying), not adverts or listings, and they are before public subsidies or funded hours unless the answer says otherwise. " +
    "Each answer is an official average or median (price_type official_statistic): the range fields are null, and there is a sample size only where the publisher gives one. " +
    "Every answer states its unit (for example US dollars per week, or pounds per hour), the year it describes, a confidence label, and the official source and licence. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Some of this data is several years old: always read the period in the answer. " +
    "Do not use for the cost of a specific nursery, advertised fees or waiting-list prices, the value of government subsidies, tuition for schools or universities, babysitting or nanny wages, or other countries.",
  params: {
    area: z.string().min(2).optional().describe("Place: a county, a region, a local authority, or a state or city where the source says so (examples: 'Cook County, IL', 'London', 'Dublin'). Leave out for the whole country, where the source has a national figure."),
    age_group: z.enum(["infant", "toddler", "preschool", "school-age"]).optional().describe("Age of the child: infant (under 2), toddler (2), preschool (3 to 4 or until school), school-age. Each source says how it defines them. Leave out for the source's default (see the answer)."),
    care_type: z.enum(["centre", "home-based", "childminder"]).optional().describe("centre = nursery, daycare or group-based setting; home-based (also childminder) = a registered provider caring in their own home. Leave out for centres or for all providers, as the source says."),
    hours: z.enum(["full-time", "part-time"]).optional().describe("Full-time or part-time care, where a source publishes both. Most sources publish one basis only and say which."),
  },
  prepare: (p) => {
    const out = { ...p };
    const age = str(p.age_group);
    if (age !== undefined) {
      const a = AGE_ALIASES[key(age)];
      if (!a) throw new InputError('age_group must be "infant", "toddler", "preschool" or "school-age".');
      out.age_group = a;
    }
    const care = str(p.care_type);
    if (care !== undefined) {
      const c = CARE_ALIASES[key(care)];
      if (!c) throw new InputError('care_type must be "centre" or "home-based" (also written childminder).');
      out.care_type = c;
    }
    const hrs = str(p.hours);
    if (hrs !== undefined) {
      const h = HOURS_ALIASES[key(hrs)];
      if (!h) throw new InputError('hours must be "full-time" or "part-time".');
      out.hours = h;
    }
    return out;
  },
});
