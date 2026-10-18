// Tool: the modelled cost of the cheapest healthy diet per person per day, by country. Sources plug in by declaring category "diet-costs".
// The tool name pricepaid_diet_costs is public once released: never rename it.
// This is NOT a shop price: researchers combine food prices collected for the International Comparison Program with nutrition rules
// to work out the cheapest set of foods that gives a healthy diet, then publish one national figure per year.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "diet-costs",
  tool: "pricepaid_diet_costs",
  restPath: "diet-costs",
  cacheSeconds: 86400,
  title: "Cost of a healthy diet per person per day",
  noun: "Healthy diet cost",
  description: (places) =>
    "Use this when a user asks how much it costs to eat healthily in a country, for example the cost of the cheapest healthy diet per person per day, how that cost changed on a year earlier, or how much of it goes on fruit, vegetables, animal-source foods, legumes and nuts, oils and fats or starchy staples, in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the World Bank's modelled cost of a least-cost healthy diet, built from the food prices collected for the International Comparison Program: the figure in the country's own currency and in international (PPP) dollars, the year, " +
    "the change on the previous year, the years since 2017, and the official source and licence. " +
    "This is a modelled national estimate (price_type official_statistic), not a shop receipt, not what one household paid and not a range, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for the price of a particular food or shop, restaurant meals, a family's real food bill, or for countries that are not listed.",
  params: {
    food_group: z
      .string()
      .optional()
      .describe("Which part of the healthy diet: leave out for the whole diet, or give 'fruit', 'vegetables', 'animal foods', 'legumes and nuts', 'oils and fats' or 'starchy staples'. The World Bank leaves some group figures blank."),
    year: z
      .number()
      .int()
      .min(2017)
      .max(2100)
      .optional()
      .describe("Year of the estimate (2017 onwards). Leave out for the newest year the World Bank holds."),
  },
  prepare: (p) => {
    const { food_group: _g, year: _y, ...rest } = p;
    const group = str(p.food_group);
    if (group && group.length > 60) throw new InputError("food_group is too long: use a few words such as 'fruit' or 'animal foods'.");
    return { ...rest, ...(group ? { food_group: group } : {}), ...(p.year !== undefined && p.year !== null && p.year !== "" ? { year: p.year } : {}) };
  },
});
