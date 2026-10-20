// Tool: prices at wholesale produce markets (auction/trading averages for vegetables and fruit). Sources plug in by declaring category "wholesale-markets".
// The tool name pricepaid_wholesale_market_prices is public once released: never rename it.
// Not shop prices and not farm-gate prices: these are what traders paid at the wholesale market, summarised as a range across market-days.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "wholesale-markets",
  tool: "pricepaid_wholesale_market_prices",
  restPath: "wholesale-markets",
  cacheSeconds: 21600,
  title: "Wholesale market prices for vegetables and fruit",
  noun: "Wholesale market prices",
  description: (places) =>
    "Use this when a user asks what traders paid for vegetables or fruit (cabbage, tomatoes, cucumbers, onions, bananas, pineapples, guavas, melons, grapes...) at the wholesale produce markets of " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, or what the price range at the wholesale market was this week. ` +
    "Returns a range built from the market's own daily trading records (median, 10th to 90th percentile, lowest and highest, number of records) for the newest few days, per kilogram, " +
    "with the volume traded, the markets included and the official source and licence. " +
    "A record is the average price of one variety at one market on one day. " +
    `How fresh: ${freshnessList(places)}. ` +
    "These are wholesale prices between traders, not what a shopper pays and not what a farmer receives. " +
    "Do not use for supermarket or shop prices, for the price one farm received, for flowers, meat or fish, for futures prices, or for other countries.",
  params: {
    product: z
      .string()
      .describe("The vegetable or fruit in plain words, e.g. 'cabbage', 'tomato', 'banana', 'pineapple'. The local-language name also works. The full list is in the tool notes."),
    market: z
      .string()
      .optional()
      .describe("One wholesale market, only where the source publishes by market (for example a city name). Leave out for all markets together."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'cabbage', 'tomato', 'banana' or 'pineapple'.");
    if (product.length > 60) throw new InputError("product is too long: use a word or two such as 'cabbage' or 'banana'.");
    const { market: _ignored, ...rest } = p;
    const market = str(p.market) ?? str(p.region) ?? str(p.area) ?? str(p.city);
    return { ...rest, product, ...(market ? { market } : {}) };
  },
});
