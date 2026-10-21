// Manifest: Bank of Canada interest rates charged on new lending by chartered banks (funds advanced). Logic lives in ./source.ts.
import { defineSource } from "../../lib/plugin";
import { answerRate, backfillSource, harvestSource, rateHistoryKey } from "../_rates/rates";
import { INFO, CATALOG, makeSource } from "./source";

const src = makeSource();

export default defineSource({
  info: INFO,
  category: "interest-rates",
  countries: ["CA"],
  countryHelp: "CA = Canada (Bank of Canada: official monthly average interest rates charged on funds advanced, i.e. new lending, by chartered banks, in % a year)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    product:
      "CA: mortgage (answered with the uninsured mortgage rate, and says so), mortgage_insured, mortgage_uninsured, consumer_loan and business_loan (totals only). No deposit rates.",
    term: "CA: mortgages total (default), floating (variable rate), up-to-1y, 1-3y, 3-5y, over-5y (fixed terms); consumer_loan and business_loan: total only.",
    months: "CA: months of history come from the Bank of Canada series; the newest month is published about eleven weeks after it ends.",
  },
  examples: [
    { params: { country: "CA", product: "mortgage_uninsured" } },
    { params: { country: "CA", product: "mortgage_insured", term: "over-5y" }, smoke: false },
    { params: { country: "CA", product: "consumer_loan" }, smoke: false },
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
