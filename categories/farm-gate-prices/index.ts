// Tool: monthly prices that farmers receive for crops and livestock, from national statistics offices outside the EU. Sources plug in by
// declaring category "farm-gate-prices". The tool name pricepaid_farm_gate_prices is public once released: never rename it.
// (EU member states are in "farm-prices"; annual FAOSTAT figures are in "producer-prices".)
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "farm-gate-prices",
  tool: "pricepaid_farm_gate_prices",
  restPath: "farm-gate-prices",
  cacheSeconds: 86400,
  title: "Farm-gate prices received by farmers (monthly)",
  noun: "Farm-gate prices",
  description: (places) =>
    "Use this when a user asks what farmers received, per month, for a crop or animal product (wheat, barley, oats, canola, soybeans, corn, potatoes, cattle, hogs, lambs, chickens, turkeys, milk, eggs) " +
    `in a region of ${joinOr(places.map((p) => p.place))}, or how that price compares with the month before or a year earlier. ` +
    "Returns the newest monthly price the statistics office publishes for the product and region, in the unit the office uses (per tonne, per hundredweight, per dozen, per kilolitre), " +
    "the month it applies to, the change on the previous month and a year earlier, the last 12 months, the same product in other regions, and the official source and licence. " +
    "This is a published monthly average price received by farmers (price_type official_statistic), not a range built from sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Always read the month in the answer. Do not use for supermarket or shop prices, for wholesale market quotes, for the price of a particular farm, field or animal, for farmland, for fuel or energy, for futures prices, or for EU member states.",
  params: {
    product: z
      .string()
      .describe("The crop or animal product, e.g. 'wheat', 'barley', 'oats', 'canola', 'soybeans', 'corn', 'potatoes', 'cattle', 'hogs', 'lambs', 'chickens', 'milk', 'eggs'. The full list is in the tool notes."),
    region: z
      .string()
      .optional()
      .describe("Region inside the country, as the statistics office publishes it (for example a province or state). Some countries publish no national figure, so the answer then asks for a region."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'wheat', 'canola', 'hogs', 'milk' or 'eggs'.");
    if (product.length > 80) throw new InputError("product is too long: use a few words such as 'wheat' or 'milk'.");
    const { region: _ignored, ...rest } = p;
    const region = str(p.region);
    return { ...rest, product, ...(region ? { region } : {}) };
  },
});
