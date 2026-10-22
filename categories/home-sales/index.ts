// Tool: home sale prices actually paid. Sources plug in by declaring category "home-sales".
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "home-sales",
  tool: "pricepaid_home_sales",
  restPath: "home-sales",
  cacheSeconds: 86400,
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
  history: {
    tool: "pricepaid_home_sales_history",
    title: "Home sale price history",
    description:
      "Use this when a user asks how home sale prices have changed over time in a place, or whether homes are getting more or less expensive. " +
      "Returns the median and typical range (10th-90th percentile) of prices actually paid, with the change over the period: monthly figures over many years (pass months, up to 360) " +
      "where a source has loaded long history, otherwise recent daily snapshots (pass days). Aggregates of official sale records only. " +
      "Do not use for the current price, rents or asking prices.",
    minDays: 7,
    // items: "<type>:<N>m" (rolling N months), "<type>/month" (monthly), or "<type>:total:<N>m" (Taiwan: total price, rolling N months)
    itemLabel: (item) => {
      const parts = item.split(/[:/]/);
      const type = parts[0];
      const win = parts[parts.length - 1];
      const KINDS: Record<string, string> = {
        new: "New homes", "second-hand": "Second-hand homes", apartment: "Apartments", house: "Houses",
        "high-rise": "High-rise flats", "mid-rise": "Mid-rise flats", "walk-up": "Walk-up flats",
      };
      const kind = KINDS[type] ?? "Homes";
      return win === "month" ? `${kind}, monthly` : `${kind}, rolling ${win?.replace("m", "") ?? ""} months`;
    },
  },
});
