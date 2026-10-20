// Tool: how expensive a country is compared with the OECD average (or the USA or the EU), for everyday spending groups. Sources plug in by declaring category "price-levels".
// The tool name pricepaid_price_levels is public once released: never rename it.
// This is NOT a shop price: it is a price level index from the purchasing power parity (PPP) surveys of statistics offices, so there is no range and no sample size.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "price-levels",
  tool: "pricepaid_price_levels",
  restPath: "price-levels",
  cacheSeconds: 86400,
  title: "Price levels: how expensive a country is compared with others",
  noun: "Price level",
  description: (places) =>
    "Use this when a user asks how expensive a country is compared with an international average, for everyday spending such as food, housing, transport, health, clothing or restaurants, " +
    "for example 'is food dearer here than in a neighbouring country', 'how much more expensive is a country than the average' or what a dollar buys in local currency (purchasing power parity), in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the price level index (100 = the comparison average, 120 = prices 20% above it), the PPP rate in national currency, the year, the last years, the rank among the countries surveyed, and the official source and licence. " +
    "This is a price level index from the international PPP survey (price_type official_statistic), not a shop price, not a receipt and not a range, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for the price of a particular product, a town or city, exchange rates on the money market, or for countries that are not listed.",
  params: {
    spend: z
      .string()
      .optional()
      .describe("What kind of spending: leave out for all household consumption, or give 'food', 'meat', 'dairy', 'bread and cereals', 'fruit', 'vegetables', 'alcohol', 'tobacco', 'clothing', 'housing' (rent, water, energy), 'furnishings', 'health', 'transport', 'cars', 'communication', 'recreation', 'education', 'restaurants and hotels', 'goods' or 'services'."),
    compare_to: z
      .string()
      .optional()
      .describe("What the index is measured against, as a short name of a comparison area. Leave out for the default; the allowed values are listed in the notes for the country."),
  },
  prepare: (p) => {
    const { spend: _s, compare_to: _c, ...rest } = p;
    const spend = str(p.spend);
    const cmp = str(p.compare_to);
    if (spend && spend.length > 80) throw new InputError("spend is too long: use a few words such as 'food' or 'housing'.");
    if (cmp && cmp.length > 20) throw new InputError("compare_to must be OECD, USA or EU.");
    return { ...rest, ...(spend ? { spend } : {}), ...(cmp ? { compare_to: cmp } : {}) };
  },
});
