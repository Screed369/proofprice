// Manifest: Bank of England effective interest rates on new lending and deposits (UK). Logic lives in ./source.ts.
import { defineSource } from "../../lib/plugin";
import { answerRate, backfillSource, harvestSource, rateHistoryKey } from "../_rates/rates";
import { INFO, CATALOG, makeSource } from "./source";

const src = makeSource();

export default defineSource({
  info: INFO,
  category: "interest-rates",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (Bank of England Database: official monthly averages of the effective rates on new lending and new fixed-rate bond deposits, in % a year)",
  placeName: "the United Kingdom",
  status: "live",
  paramNotes: {
    product:
      "GB: mortgage (new loans secured on dwellings to individuals), consumer_loan (other loans to individuals, including consumer credit), business_loan (private non-financial corporations), business_loan_small (SMEs), deposit (new fixed-rate bonds from individuals). No overnight or notice deposits, no large-business split.",
    term: "GB: loans total (default), floating, fixed; mortgage also up-to-2y and 5y (fixed); consumer_loan also 1-5y (fixed); deposit: total, up-to-1y, 1-2y, over-2y.",
    months: "GB: months of history come from the Bank of England series; the newest month is published about five weeks after it ends.",
  },
  examples: [
    { params: { country: "GB", product: "mortgage" } },
    { params: { country: "GB", product: "mortgage", term: "up-to-2y" }, smoke: false },
    { params: { country: "GB", product: "business_loan_small" }, smoke: false },
  ],
  method: src.method,
  handle: (p, ctx) => answerRate(src, p, ctx),
  harvest: () => harvestSource(src),
  backfill: (from, to) => backfillSource(src, from, to),
  historyKey: (p) => rateHistoryKey(CATALOG, INFO.name, p),
  referenceDates: true,
  nominalCounts: true,
  statisticMeasure: "average",
});
