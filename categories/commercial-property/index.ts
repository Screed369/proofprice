// Tool: commercial property and land sale prices actually paid. Sources plug in by declaring category "commercial-property".
// The tool name pricepaid_commercial_property is public: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const TYPE_ALIASES: Record<string, "commercial" | "land"> = {
  commercial: "commercial", shop: "commercial", shops: "commercial", office: "commercial", offices: "commercial", retail: "commercial",
  industrial: "commercial", warehouse: "commercial", premises: "commercial", "commercial premises": "commercial", "commercial property": "commercial",
  land: "land", plot: "land", plots: "land", "building plot": "land", "building land": "land", lot: "land", "land plot": "land",
};

export default defineCategory({
  id: "commercial-property",
  tool: "pricepaid_commercial_property",
  restPath: "commercial-property",
  cacheSeconds: 86400,
  title: "Commercial property and land sale prices actually paid",
  noun: "Commercial property and land sales",
  description: (places) =>
    "Use this when a user asks what shops, offices, workshops, warehouses or other commercial premises actually sold for, or what a plot of non-farm land (a building plot) sold for, per square metre, in a town or postcode, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. Returns the median price per square metre, a typical range (10th–90th percentile), ` +
    "the number of sales, the period covered, a confidence label, and the official source and licence, from government sale records (prices paid, not asking prices). " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for homes, farmland, rents, asking prices or listings, the value of one particular building, or other countries.",
  params: {
    town: z.string().min(2).optional().describe("Town or city."),
    postcode: z.string().optional().describe("Postcode, for a precise area."),
    property_type: z.enum(["commercial", "land"]).optional().describe("commercial = shops, offices, workshops and other commercial or industrial premises (default); land = building plots and other non-farm land sold without a building."),
    months: z.number().int().min(1).max(36).optional().describe("How many recent months to include. Default 24."),
  },
  prepare: (p) => {
    const t = str(p.property_type);
    if (t === undefined) return p;
    const v = TYPE_ALIASES[t.toLowerCase().replace(/[_\s]+/g, " ").trim()];
    if (!v) throw new InputError('property_type must be "commercial" (shops, offices, workshops) or "land" (building plots).');
    return { ...p, property_type: v };
  },
});
