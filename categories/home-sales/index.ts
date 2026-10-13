// Tool: home sale prices actually paid. Sources plug in by declaring category "home-sales".
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "home-sales",
  tool: "pricepaid_home_sales",
  restPath: "home-sales",
  title: "Home sale prices actually paid",
  noun: "Home sales",
  description: (places) =>
    "Use this when a user asks what homes actually sold for in a town or area, what a fair price for a home is, or how much property costs there, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. Returns the median sale price, a typical range (10th–90th percentile), ` +
    "the number of sales, the period covered, a confidence label, and the official source and licence, from government sale records. " +
    "Do not use for rents, asking prices, commercial property, or other countries.",
  params: {
    town: z.string().min(2).optional().describe("Town or city."),
    postcode: z.string().optional().describe("Postcode, for a precise area."),
    property_type: z.enum(["any"]).optional().describe("Kind of home. Default 'any'."),
    months: z.number().int().min(1).max(36).optional().describe("How many recent months to include. Default 12."),
  },
});
