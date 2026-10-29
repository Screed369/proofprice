// Tool: the monthly rent awarded for leasing state-owned property (tenders, direct allocations, auctions). Sources plug in by declaring category "state-property-rents".
// The tool name pricepaid_state_property_rents is public once shipped: never rename it. Approved by Simon on 29 Oct 2026 (categories/APPROVED.json).
// Answers are rents contracted in awards for the first lease term of a state site (a plot, a building, a hostel, a childcare centre), never a home rent.
import { z } from "zod";
import { defineCategory, str, num } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const ALLOCATION: Record<string, string> = {
  tender: "tender", tenders: "tender", bid: "tender", bidding: "tender", "open tender": "tender", "e bidding": "tender", ebidding: "tender",
  direct: "direct", "rent direct": "direct", "direct allocation": "direct", "direct award": "direct",
  auction: "auction", auctions: "auction",
};
const k = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export default defineCategory({
  id: "state-property-rents",
  tool: "pricepaid_state_property_rents",
  restPath: "state-property-rents",
  cacheSeconds: 86400,
  title: "Rents awarded on state-owned property (tender and allocation results)",
  noun: "State-property rent awards",
  description: (places) =>
    "Use this when a user asks what rent was awarded, per month, for leasing state-owned land or buildings (a childcare centre, student hostel, school, office, storage or nursery site) through a government tender, direct allocation or auction, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the median monthly rent contracted for the first lease term, a typical range (10th-90th percentile), the number of awards, the period covered, a confidence label, and the official source and licence. " +
    "These are contract rents from award results (winning bids), not market rents, not asking rents and not home rents; the winning bidder is never shown. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for home rents, rents of private commercial property, sale prices, or a quote for one particular site, or for countries that are not listed.",
  params: {
    use: z.string().min(2).optional().describe("Word or phrase for the tendered use, matched in the tender's permitted uses, e.g. childcare, hostel, school, storage, nursery, office. Leave out for all awards."),
    allocation: z.enum(["tender", "direct", "auction"]).optional().describe("How the site was allocated: tender (default mix), direct = direct allocation, auction. Leave out for all."),
    years: z.number().int().min(1).max(25).optional().describe("How many award years to include, counted back from the newest year in the file. Default 10."),
  },
  prepare: (p) => {
    const out: Record<string, unknown> = { ...p };
    const a = str(p.allocation);
    if (a) {
      const v = ALLOCATION[k(a)];
      if (!v) throw new InputError('allocation must be "tender", "direct" or "auction".');
      out.allocation = v;
    }
    if (p.years !== undefined && p.years !== null && p.years !== "") {
      const y = num(p.years);
      if (y === undefined || !Number.isInteger(y) || y < 1 || y > 25) throw new InputError("years must be a whole number from 1 to 25, e.g. 10.");
      out.years = y;
    }
    return out;
  },
});
