// Tool: official average shop prices of everyday groceries (and a few drinks). Sources plug in by declaring category "groceries".
// The tool name pricepaid_grocery_prices is public: never rename it.
// These are NOT receipts: national statistics offices send price collectors into shops (and use scanner data) to record shelf
// prices for the consumer price index, and publish averages or medians for standard items. Sources give the exact item definition.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "groceries",
  tool: "pricepaid_grocery_prices",
  restPath: "groceries",
  cacheSeconds: 86400,
  title: "Grocery and everyday prices",
  noun: "Grocery prices",
  description: (places) =>
    "Use this when a user asks what an everyday grocery item (milk, bread, eggs, butter, cheese, chicken, bananas, potatoes, sugar, tea, coffee, beer, wine...) costs in the shops in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, or how that price has changed over the last year. ` +
    "Returns the official average or median shop price that the national statistics office publishes for a standard item, built from the shelf prices its price collectors record in shops for the consumer price index " +
    "(shelf prices observed by price collectors, not receipts and not what one shopper paid; the UK also uses retailers' scanner data), with the exact item definition (for example 'Full-fat milk, per 2 litres'), the unit, the reference month, " +
    "the change on a year earlier where the office publishes comparable figures (Ireland and the United States do; the UK statistics office advises against comparing months, so its answer carries none), the official source and licence. " +
    "Each country defines its own standard items, so the item definition in the answer matters and related definitions are listed. " +
    `How fresh: ${[...new Set(places.map((p) => `${p.place}: ${p.freshness.charAt(0).toLowerCase()}${p.freshness.slice(1)}`))].join("; ")}. ` +
    "This is a published national (or regional) average, not a range of individual transactions, so the range fields can be null. " +
    "Do not use for the price at a particular supermarket or online shop, loyalty-card or special-offer prices, restaurant meals, petrol or diesel (use the fuel tool), or for other countries.",
  params: {
    item: z
      .string()
      .describe("Everyday item in plain words, e.g. 'milk', 'white bread', 'eggs', 'butter', 'coffee', 'bananas', 'beer'. Each country measures its own standard pack or cut; the answer names it and lists other definitions."),
    region: z
      .string()
      .optional()
      .describe("Region inside the country, only where the statistics office publishes regional averages. Leave out for the national average."),
  },
  required: ["item"],
  prepare: (p) => {
    const item = str(p.item);
    if (!item) throw new InputError("item is required: an everyday item in plain words such as 'milk', 'white bread', 'eggs' or 'coffee'.");
    if (item.length > 80) throw new InputError("item is too long: use a few words such as 'milk' or 'white bread'.");
    const { region: _ignored, ...rest } = p;
    const region = str(p.region);
    return { ...rest, item, ...(region ? { region } : {}) };
  },
});
