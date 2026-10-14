// Tool: farmland prices and rents per hectare (official statistics). Sources plug in by declaring category "land-prices".
// The tool name pricepaid_land_prices is public: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr } from "../../lib/text";

const MEASURE_ALIASES: Record<string, "price" | "rent"> = {
  price: "price", prices: "price", sale: "price", "sale price": "price", purchase: "price", buy: "price", value: "price",
  rent: "rent", rents: "rent", rental: "rent", renting: "rent", lease: "rent", leasing: "rent",
};

export default defineCategory({
  id: "land-prices",
  tool: "pricepaid_land_prices",
  restPath: "land-prices",
  cacheSeconds: 86400,
  title: "Farmland prices and rents",
  noun: "Farmland prices and rents",
  description: (places) =>
    "Use this when a user asks what agricultural land (farmland, arable land or grassland) sells for, or what it costs to rent, per hectare in " +
    `${joinOr(places.map((p) => p.place))}, in a particular region of such a country, or how it changed since the year before. ` +
    "Returns the official average price per hectare (or the average rent per hectare for one year) for the latest year published, in euro and in national currency, " +
    "for the chosen land type (arable, permanent grassland and others), the previous year and change, the history, the other land types, the regions that exist, and the official source and licence. " +
    "This is a published average (price_type official_statistic), not a range built from sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${[...new Set(places.map((p) => p.freshness.charAt(0).toLowerCase() + p.freshness.slice(1)))].join("; ")}. ` +
    "Always read the reference year in the answer: the data are about two years behind and some countries are much older. " +
    "Do not use for the value of a particular field or farm, for house or building land or commercial property, for listings or asking prices, or for other countries.",
  params: {
    measure: z.enum(["price", "rent"]).describe("price = what agricultural land sells for per hectare; rent = what it costs to rent per hectare for one year."),
    land_type: z.string().optional().describe("Land type, e.g. 'arable', 'permanent grassland', 'arable or grassland' (rent only), 'irrigable arable' (price only). Leave out for the usual one."),
    region: z.string().optional().describe("Optional NUTS region code for a regional figure, e.g. ES51. Leave out for the whole country."),
  },
  required: ["measure"],
  prepare: (p) => {
    const measure = MEASURE_ALIASES[(str(p.measure) ?? "").toLowerCase().replace(/[\s_-]+/g, " ")];
    if (!measure) throw new InputError('measure must be "price" (what farmland sells for per hectare) or "rent" (what it costs to rent per hectare for a year).');
    return { ...p, measure };
  },
});
