// Manifest: US federal government contract prices (USAspending.gov). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, usContracts } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["US"],
  countryHelp: "US = United States, federal agencies' contracts only (not state or local governments)",
  placeName: "the United States (federal contracts)",
  status: "live",
  paramNotes: {
    what: "US: a phrase searched in the federal award descriptions (common purchases such as 'laptops' use a tuned keyword; 'road resurfacing' uses the road-repair product code Z2LB). Several words must appear together, so shorter is better.",
    cpv: "US: a product or service code (PSC, e.g. 7010 or psc:7010) or a NAICS code (e.g. 334111 or naics:334111) instead of the keyword; there are no CPV codes in the US.",
    buyer_area: "US: a state name or code ('Virginia', 'VA'); filters by where the work is done.",
    months: "US: 1 to 60 months of new awards, read in up to 12 slices.",
  },
  examples: [
    { params: { country: "US", what: "laptops" } },
    { params: { country: "US", what: "road resurfacing", buyer_area: "Virginia" }, smoke: false },
  ],
  method:
    "US federal contract awards and orders from USAspending.gov, found by keyword (or PSC / NAICS code) and period; each award's total obligated amount is one contract. Median and 10th–90th percentile in USD. Totals per contract, not unit prices; contractors are never named.",
  handle: (p, ctx) => {
    return usContracts({
      what: String(p.what),
      cpv: str(p.cpv),
      buyer_area: str(p.buyer_area),
      months: num(p.months) ?? 24,
      baseUrl: ctx.baseUrl,
    });
  },
});
