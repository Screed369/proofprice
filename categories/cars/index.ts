// Tool: car-related prices actually paid (the right to own a car, sale and auction results). Sources plug in by declaring category "cars".
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "cars",
  tool: "pricepaid_car_prices",
  restPath: "cars",
  cacheSeconds: 86400,
  title: "Car-related prices actually paid",
  noun: "Car prices",
  description: (places) =>
    "Use this when a user asks what people actually paid for the right to own or buy a car (an entitlement or quota certificate, a sale or an auction result) " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. Returns the median winning price, a typical range (10th–90th percentile), ` +
    "the number of bidding rounds or sales, the period covered, a confidence label, and the official source and licence. " +
    "Do not use for asking prices, dealer listings, or other countries.",
  params: {
    product: z.enum(["coe"]).optional().describe("Which price. 'coe' = Certificate of Entitlement bidding results (the country notes say where it exists). Default 'coe'."),
    months: z.number().int().min(1).max(60).optional().describe("How many recent months to include. Default 12."),
  },
});
