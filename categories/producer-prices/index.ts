// Tool: annual farm-gate producer prices from FAOSTAT (official statistics) for countries outside the EU. Sources plug in by declaring category "producer-prices".
// The tool name pricepaid_producer_prices is public once released: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "producer-prices",
  tool: "pricepaid_producer_prices",
  restPath: "producer-prices",
  cacheSeconds: 86400,
  title: "Farm-gate producer prices (annual)",
  noun: "Farm-gate producer prices",
  description: (places) =>
    "Use this when a user asks what farmers received at the farm gate, per year, for a crop or animal product (wheat, maize, rice, soybeans, potatoes, tomatoes, apples, bananas, beef, pork, chicken, eggs, milk, coffee, cotton and many more) " +
    `in ${joinOr(places.map((p) => p.place))}, or how that annual price changed from the year before. ` +
    "Returns the newest annual producer price for the country and product, per tonne in the country's own currency (and in US dollars where available) and per kg, the year it applies to, the change on the previous year, " +
    "whether the source marks the figure as estimated, related products, and the official source and licence. " +
    "This is a published official statistic (price_type official_statistic), not a range built from sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Always read the year in the answer: the newest annual figure is often one to two years old. " +
    "Do not use for weekly or daily market quotes, for supermarket or shop prices, for the price of a particular farm, field or animal, for farmland, for fuel or energy, or for futures prices.",
  params: {
    product: z
      .string()
      .describe("The crop or animal product, e.g. 'wheat', 'maize', 'rice', 'soybeans', 'potatoes', 'tomatoes', 'apples', 'bananas', 'beef', 'pork', 'chicken', 'eggs', 'milk', 'coffee', 'cotton'."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'wheat', 'maize', 'rice', 'soybeans', 'beef' or 'milk'.");
    return { ...p, product };
  },
});
