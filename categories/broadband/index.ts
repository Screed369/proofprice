// Tool: mobile and fixed broadband prices (posted offers, published as official statistics). Sources plug in by declaring category "broadband".
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "broadband",
  tool: "pricepaid_broadband_prices",
  restPath: "broadband",
  cacheSeconds: 86400,
  title: "Mobile and broadband prices",
  noun: "Mobile and broadband prices",
  description: (places) =>
    "Use this when a user asks what home internet (fixed broadband at a given speed, with or without phone and TV) or a mobile data plan costs per month in " +
    `${joinOr(places.map((p) => p.place))}, or how that compares between countries. ` +
    "Returns the official figure for a standard offer in the latest year published, the previous year and the change, and the same country's other offers, with the official source and licence. " +
    "It is the cheapest posted offer of the largest operators, not what customers actually paid, and not a range built from sales: the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for a quote from one provider, for business lines, or for countries that are not listed.",
  params: {
    offer: z
      .string()
      .optional()
      .describe("Which standard offer. Friendly names such as fixed_100_200 (fixed internet 100-200 Mbps, the default), fixed_30_100, fixed_1gbps, mobile_10gb, mobile_unlimited, or a publisher code. The country notes list them."),
  },
});
