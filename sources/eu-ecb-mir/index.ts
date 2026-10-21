// Manifest: ECB MFI interest rate statistics (MIR): average rates agreed on new loans and deposits, euro area and its member countries. Logic lives in ./source.ts.
import { defineSource } from "../../lib/plugin";
import { answerRate, backfillSource, harvestSource, rateHistoryKey } from "../_rates/rates";
import { AREAS, INFO, CATALOG, makeSource } from "./source";

const src = makeSource();

export default defineSource({
  info: INFO,
  category: "interest-rates",
  countries: AREAS.map((a) => a.code),
  countryHelp:
    "Euro area (EA) and its member countries (ECB MFI interest rate statistics, official monthly averages on new business, in % a year): " + AREAS.map((a) => `${a.code} = ${a.name.replace(/^the /, "")}`).join(", "),
  placeName: "the euro area and its member countries",
  status: "live",
  paramNotes: {
    product:
      "Euro area and member countries: mortgage (loans for house purchase), consumer_loan (loans for consumption), business_loan (non-financial corporations, any size), business_loan_small (up to EUR 1 million), business_loan_large (over EUR 1 million), " +
      "deposit (household deposits with an agreed maturity), deposit_overnight, deposit_notice.",
    term:
      "Euro area and member countries, loans (initial rate-fixation period): total (default), floating (floating rate or fixation up to 1 year), up-to-3m, 3m-1y, 1-3y, 3-5y (business only), 1-5y, over-5y, 5-10y, over-10y, over-1y; " +
      "mortgage also composite (the ECB's cost-of-borrowing indicator). Deposits: total, up-to-1y, 1-2y, over-2y, over-1y, up-to-2y; deposit_notice: total, up-to-3m, over-3m. Not every country has every term.",
    months: "Euro area and member countries: months of history come from the ECB series; the newest month is published about five weeks after it ends.",
  },
  examples: [
    { params: { country: "EA", product: "mortgage" } },
    { params: { country: "IE", product: "mortgage", term: "1-5y" }, smoke: false },
    { params: { country: "ES", product: "mortgage" }, smoke: false },
    { params: { country: "DE", product: "business_loan_small" }, smoke: false },
    { params: { country: "FR", product: "deposit", term: "up-to-1y" }, smoke: false },
  ],
  method: src.method,
  handle: (p, ctx) => answerRate(src, p, ctx),
  // A daily copy of the newest published month and a history loader (24 months), so answers come from our stored copy and an ECB outage is covered.
  // Rows are dated by the end of the reference month and each is one published figure (n = 5 is a placeholder).
  harvest: () => harvestSource(src),
  backfill: (from, to) => backfillSource(src, from, to),
  historyKey: (p) => rateHistoryKey(CATALOG, INFO.name, p),
  referenceDates: true,
  nominalCounts: true,
  statisticMeasure: "average",
});
