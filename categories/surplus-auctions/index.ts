// Tool: what surplus and seized goods actually sold for at public auction. Sources plug in by declaring category "surplus-auctions".
// The tool name pricepaid_auction_prices is public once released: never rename it.
import { z } from "zod";
import { defineCategory, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "surplus-auctions",
  tool: "pricepaid_auction_prices",
  restPath: "auctions",
  cacheSeconds: 21600,
  title: "Public auction prices (winning bids on surplus goods)",
  noun: "Public auction prices",
  description: (places) =>
    "Use this when a user asks what used, surplus or seized goods (vehicles, heavy equipment, electronics, office furniture, tools and similar) " +
    `went for at public auction in ${joinOr(places.map((p) => p.place))}. Returns the median final bid on sold lots, a typical range (10th–90th percentile), ` +
    `the number of lots, the period, and the source and licence. How fresh: ${freshnessList(places)}. ` +
    "These are winning bid levels on lots marked sold (before any buyer premium, not confirmed receipts) for used goods, not retail prices. Nothing is returned for fewer than 5 lots, and no seller or lot is named. " +
    "Do not use for new goods, shop prices or other countries.",
  params: {
    what: z
      .string()
      .min(2)
      .describe("Lot type: a group name or words from the lot title, such as 'vehicles', 'heavy equipment', 'office furniture' or 'forklift'."),
    state: z.string().optional().describe("Optional region to narrow to, see the country notes below."),
    months: z.number().int().min(1).max(24).optional().describe("How many recent months of auctions to include. Default 12."),
  },
  required: ["what"],
  prepare: (p) => {
    const what = (str(p.what) ?? "").replace(/\s+/g, " ").trim();
    if (what.length < 2) throw new InputError("what is required: say what sold, for example 'vehicles', 'office furniture' or 'forklift'.");
    const months = Math.round(num(p.months) ?? 12);
    if (!(months >= 1 && months <= 24)) throw new InputError("months must be between 1 and 24.");
    return { ...p, what, months, state: str(p.state) };
  },
});
