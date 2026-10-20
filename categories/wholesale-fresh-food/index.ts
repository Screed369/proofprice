// Tool: wholesale prices of fresh food that is not vegetables and fruit: livestock, poultry, fish, eggs (and some vegetables). Sources plug in by declaring category "wholesale-fresh-food".
// The tool name pricepaid_wholesale_fresh_food_prices is public once released: never rename it.
// Not shop prices and not paid prices: a government department publishes the reference prices that wholesalers report for the day.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "wholesale-fresh-food",
  tool: "pricepaid_wholesale_fresh_food_prices",
  restPath: "wholesale-fresh-food",
  cacheSeconds: 21600,
  title: "Wholesale prices of live animals, fish, eggs and fresh food",
  noun: "Wholesale fresh food prices",
  description: (places) =>
    "Use this when a user asks what the wholesale price of live pigs, cattle or chickens, fish, eggs or other fresh food is today in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, or how it moved on the previous day. ` +
    "Returns the newest daily average reference wholesale price that the government publishes for the food type, per kilogram or per egg, " +
    "with the day it applies to, the change on the previous published day, the recent days, the official source and licence. " +
    "This is a posted reference price reported by wholesalers (price_type posted_price), not a paid price and not a range built from sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for supermarket or shop prices, for the price one farm received, for restaurant prices, for futures prices, or for other countries.",
  params: {
    product: z
      .string()
      .describe("The food in plain words, e.g. 'live pig', 'chicken', 'eggs', 'grass carp', 'tomato'. The list for each country is in the tool notes."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'live pig', 'chicken', 'eggs' or 'tomato'.");
    if (product.length > 60) throw new InputError("product is too long: use a word or two such as 'live pig' or 'eggs'.");
    return { ...p, product };
  },
});
