// Manifest: UK government contract prices (Contracts Finder awarded contracts). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { gbContracts, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (Contracts Finder awarded contracts)",
  placeName: "the United Kingdom (Contracts Finder)",
  status: "live",
  paramNotes: {
    what: "GB: a keyword or phrase searched in the award notices (common purchases such as 'laptops' or 'road resurfacing' use a tuned keyword). Several words are searched as an exact phrase, so shorter is better.",
    cpv: "GB: a full 8-digit CPV code (45233142) instead of the keyword; only notices that list the code themselves are used.",
    buyer_area: "GB: a region ('London', 'North West', 'Scotland', 'Wales', 'Yorkshire and The Humber' ...); nationwide contracts that list the region are included.",
    months: "GB: 1 to 60 months, by award date.",
  },
  examples: [
    { params: { country: "GB", what: "road resurfacing" } },
    { params: { country: "GB", what: "laptops", buyer_area: "London" }, smoke: false },
  ],
  method:
    "UK awarded-contract notices from Contracts Finder, found by keyword (or CPV code), region and award date; each notice's awarded value is one contract. Median and 10th–90th percentile in GBP. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) => {
    return gbContracts({
      what: String(p.what),
      cpv: str(p.cpv),
      buyer_area: str(p.buyer_area),
      months: num(p.months) ?? 24,
      baseUrl: ctx.baseUrl,
    });
  },
});
