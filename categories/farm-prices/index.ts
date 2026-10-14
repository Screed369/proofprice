// Tool: farm and wholesale food prices (official statistics). Sources plug in by declaring category "farm-prices".
// The tool name pricepaid_farm_prices is public: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "farm-prices",
  tool: "pricepaid_farm_prices",
  restPath: "farm-prices",
  cacheSeconds: 86400,
  title: "Farm and wholesale food prices",
  noun: "Farm and wholesale food prices",
  description: (places) =>
    "Use this when a user asks what farmers or wholesalers get for a food commodity (wheat, barley, maize, beef, pigs, lamb, chicken, eggs, milk, butter and other dairy products, olive oil, " +
    `fruit and vegetables) in ${joinOr(places.map((p) => p.place))}, how that price compares with last week, last month or a year ago, or how high it is against the last 12 months. ` +
    "Returns the latest official price for the country and product, per tonne or per 100 kg and per kg, for the week (milk: month) it applies to, the stage of the supply chain it is quoted at (farm gate, ex-silo, carcass, ex-packaging station), " +
    "the change from the previous period and from a year earlier, the last 12 months, the other series the portal holds, and the official source and licence. " +
    "This is a published price (price_type official_statistic), not a range built from trades, so the range fields are null and there is no sample size. " +
    `How fresh: ${[...new Set(places.map((p) => p.freshness.charAt(0).toLowerCase() + p.freshness.slice(1)))].join("; ")}. ` +
    "Always read the period in the answer: an old quote is flagged and given lower confidence. " +
    "Do not use for supermarket or shop prices, for the price of a particular farm, field, animal or meal, for farmland (use the land prices tool), for fuel or energy, for futures or stock-market prices, or for other countries.",
  params: {
    product: z
      .string()
      .describe("The product, e.g. 'wheat', 'barley', 'beef', 'pig', 'lamb', 'chicken', 'eggs', 'milk', 'butter', 'olive oil', 'tomatoes', 'apples'. The full list is in the tool notes."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'wheat', 'pig', 'milk', 'olive oil' or 'tomatoes'.");
    return { ...p, product };
  },
});
