// Manifest: US federal hourly labour ceiling rates (GSA CALC+). Logic lives in ./source.ts.
// Shares the US contracts shelf with us-usaspending: hourly labour-rate questions come here, everything else stays with USAspending
// (both sides decide with isLaborRateRequest in categories/contracts/labor.ts; the usaspending serves() change is declared in the same commit).
import { defineSource, str } from "../../lib/plugin";
import { isLaborRateRequest } from "../../categories/contracts/labor";
import { INFO, usLaborRates } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["US"],
  countryHelp: "US = United States, federal schedule contracts' hourly labour ceiling rates (GSA CALC+)",
  placeName: "the United States (federal labour rates)",
  status: "live",
  serves: (p) => isLaborRateRequest(p),
  paramNotes: {
    what: "US hourly labour rates: say the job and 'hourly rate', e.g. 'software engineer hourly rate'. The figure is a federal contract CEILING rate per hour, not a price paid.",
    cpv: "US hourly labour rates: optional GSA schedule SIN as 'sin:541330ENG'.",
  },
  examples: [{ params: { country: "US", what: "software engineer hourly rate" } }, { params: { country: "US", what: "project manager hourly rate" }, smoke: false }],
  method:
    "GSA CALC+ labour-category lines found by keyword (or schedule SIN); the median and 10th–90th percentile of the current hourly ceiling rates in US dollars, as computed by GSA's index. Ceiling rates, not prices paid; contractors are never named.",
  handle: (p, ctx) => usLaborRates({ what: String(p.what), cpv: str(p.cpv), baseUrl: ctx.baseUrl }),
});
