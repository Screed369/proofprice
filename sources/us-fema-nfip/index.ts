// Manifest: US flood insurance premiums (FEMA OpenFEMA, NFIP policies). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { femaNfip, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "insurance",
  countries: ["US"],
  countryHelp: "US = United States (federal flood insurance, NFIP, from FEMA OpenFEMA)",
  placeName: "the United States (federal flood insurance)",
  status: "live",
  paramNotes: {
    area: "US: required. A 5-digit ZIP code ('32935') or a 2-letter state or territory code ('TX', 'FL'). Flood insurance from the National Flood Insurance Program only; fewer than 5 policies in the last 12 months gives no figure.",
  },
  examples: [
    { params: { country: "US", area: "32935" } },
    { params: { country: "US", area: "TX" }, smoke: false },
  ],
  method:
    "United States flood insurance: the yearly charge (premium plus federal fees and surcharges) of National Flood Insurance Program policies that took effect in the last 12 months in a ZIP code or state, from FEMA OpenFEMA. Median and 10th to 90th percentile across real policies, never fewer than 5, aggregates only. Rates follow federal rules, so these are real charges but not free-market quotes.",
  handle: (p, ctx) => femaNfip({ area: str(p.area), baseUrl: ctx.baseUrl }),
});
