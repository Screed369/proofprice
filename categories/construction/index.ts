// Tool: what building a home costs per square metre (official construction cost statistics). Sources plug in by declaring category "construction".
// The tool name pricepaid_construction_costs is public once shipped: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const COMPONENT: Record<string, "total" | "material" | "labour"> = {
  total: "total", all: "total", overall: "total", cost: "total",
  material: "material", materials: "material",
  labour: "labour", labor: "labour", "labour cost": "labour", wages: "labour",
};

export default defineCategory({
  id: "construction",
  tool: "pricepaid_construction_costs",
  restPath: "construction",
  cacheSeconds: 86400,
  title: "Building cost per square metre",
  noun: "Construction costs",
  description: (places) =>
    "Use this when a user asks what it costs to build a home or other building per square metre in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, how much of that is materials and how much is labour, or how states or regions compare. ` +
    "Returns the official average cost per square metre for the latest month published, split into materials and labour, with the previous month, the official source and licence. " +
    "This is a published survey average of unit costs (price_type official_statistic), not a range built from invoices or sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for the price of a finished home, for a builder's quote, for renovation work, or for countries that are not listed.",
  params: {
    area: z.string().optional().describe("State or region, where the publisher splits by place (the country notes say how). Leave out for the national figure."),
    component: z.enum(["total", "material", "labour"]).optional().describe("Which part of the cost: total (default), material (building materials) or labour (wages)."),
  },
  prepare: (p) => {
    const raw = str(p.component);
    if (raw === undefined) return p;
    const c = COMPONENT[raw.toLowerCase().replace(/[\s_-]+/g, " ").trim()];
    if (!c) throw new InputError('component must be "total" (default), "material" or "labour".');
    return { ...p, component: c };
  },
});
