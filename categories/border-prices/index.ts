// Tool: border prices = customs unit values (value divided by net weight) of goods crossing a country's border, from official customs statistics.
// Sources plug in by declaring category "border-prices". The tool name pricepaid_border_prices is public once released: never rename it.
// Approved by Simon on 22 Oct 2026 (Notion "Simon is needed": "New price tool: border prices (customs unit values)?", answer yes, option A).
// This is NOT a shelf price: it is the declared customs value of the goods at the border per kilogram, so there is no sample size.
import { z } from "zod";
import { defineCategory, str, num } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "border-prices",
  tool: "pricepaid_border_prices",
  restPath: "border-prices",
  cacheSeconds: 21600,
  title: "Border prices: customs unit values per kilogram",
  noun: "Border prices",
  description: (places) =>
    "Use this when a user asks what traded goods are worth at the border, per kilogram, as declared to customs: for example what a country pays per kg to import wheat, diesel, cheese or timber, " +
    `or earns per kg exporting whisky or steel, in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, optionally from or to one partner country. ` +
    "Returns the customs value divided by the net weight (a value-weighted average per kg in the reporting country's currency), a range between the 10th and 90th percentile of the individual customs lines weighted by weight, " +
    "the months it covers, the biggest partner countries and the official source and licence. " +
    "This is a customs unit value (price_type official_statistic) built from declared trade values and weights, not a shelf price, not a wholesale quote and not a receipt, so there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for what a shopper pays in a shop, for a single contract or shipment, for futures or spot quotes, for services, or for countries that are not listed.",
  params: {
    product: z
      .string()
      .describe("The goods: an everyday word such as 'wheat', 'diesel', 'cheese', 'timber', 'steel', 'whisky', or a customs commodity code (HS/CN) of 4 to 8 digits such as '1001' or '271019'."),
    direction: z.enum(["imports", "exports"]).optional().describe("Goods coming in (imports, default) or going out (exports)."),
    partner: z.string().optional().describe("Optional partner country (ISO code such as 'DE' or 'US', or its name): where the goods came from (imports) or went to (exports). Leave out for all partners."),
    period: z.string().optional().describe("Optional last month to include, as YYYY-MM. Default: the newest month the customs authority has published."),
    months: z.number().int().min(1).max(12).optional().describe("How many months to include, ending with the period. Default 1. More months smooth out lumpy shipments."),
  },
  required: ["product"],
  prepare: (p) => {
    const product = (str(p.product) ?? "").trim();
    if (!product) throw new InputError("product is required, for example 'wheat', 'diesel', 'cheese', 'timber' or a customs code such as '1001'.");
    const d = (str(p.direction) ?? "imports").toLowerCase();
    const direction = /^import/.test(d) ? "imports" : /^export/.test(d) ? "exports" : null;
    if (!direction) throw new InputError("direction must be 'imports' or 'exports'.");
    const period = str(p.period);
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new InputError("period must be a month written YYYY-MM, for example 2026-06.");
    const months = num(p.months);
    if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 12)) throw new InputError("months must be a whole number from 1 to 12.");
    const partner = str(p.partner);
    const { product: _a, direction: _b, partner: _c, period: _d, months: _e, ...rest } = p;
    return { ...rest, product, direction, ...(partner ? { partner } : {}), ...(period ? { period } : {}), ...(months !== undefined ? { months } : {}) };
  },
});
