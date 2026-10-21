// Tool: the official average interest rate banks agreed on NEW loans and paid on new deposits, by country, product and term.
// Sources plug in by declaring category "interest-rates". The tool name pricepaid_interest_rates is public once released: never rename it.
// This is an official statistic (a central bank's monthly average), not a price, a quote or an offer: one figure in "% a year", no range, no sample size.
// The tool takes ONLY a country, a product, a term and a number of months. It never takes income, age or any other personal detail, and it is
// kept out of the price-check verdict tool on purpose: "is this rate fair?" would read as financial advice.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export const PRODUCT_HELP =
  "What the rate is for: mortgage (default; a loan for house purchase), consumer_loan, business_loan (any size), business_loan_small, business_loan_large, " +
  "deposit (household term deposit), deposit_overnight, deposit_notice, or mortgage_insured / mortgage_uninsured (Canada). Each country lists what it has.";
export const TERM_HELP =
  "The term of the series where it has one: for loans the initial rate-fixation period (total = all periods together, the default; floating; fixed; up-to-3m; 3m-1y; 1-3y; 3-5y; 1-5y; 5y; 5-10y; over-5y; over-10y; over-1y), " +
  "for deposits the agreed maturity (up-to-1y; 1-2y; over-2y) or the notice period (up-to-3m; over-3m). A country answers only the terms it publishes and the error lists them.";

export default defineCategory({
  id: "interest-rates",
  tool: "pricepaid_interest_rates",
  restPath: "interest-rates",
  cacheSeconds: 86400,
  title: "Interest rates: the official average rate on new loans and deposits",
  noun: "Interest rates",
  noPriceCheck:
    "The price check does not judge interest rates. A verdict on whether a rate is fair or good would read as financial advice, and ProofPrice is not a lender, broker or insurer. " +
    "The interest-rates tool gives the official average rate for information only.",
  description: (places) =>
    "Use this when a user asks what interest rate banks actually agreed on new mortgages, consumer loans or business loans, or paid on new deposits, in a country or region, " +
    "for example 'what is the average new mortgage rate in Spain', 'what do banks charge small businesses in Ireland' or 'what do banks pay on savings deposits in the UK', in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the official average agreed rate on new loans (or the rate paid on new deposits) in % a year for the latest month published, with the reference month, up to 24 earlier months, the exact series, the source and the licence. " +
    "It is an official statistic from central bank data, passed on exactly as published: not a lender's offer, a quote or a range, so the range fields are null and there is no sample size. " +
    "product is mortgage, consumer_loan, business_loan, business_loan_small, business_loan_large, deposit, deposit_overnight or deposit_notice; term is the rate-fixation period or deposit maturity where the series has one. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for a rate to quote or offer to a person, advice on which loan or lender to choose, whether a rate is fair, the rate at one bank, central bank policy rates, or anything that depends on income, age or other personal details.",
  params: {
    product: z.string().optional().describe(PRODUCT_HELP),
    term: z.string().optional().describe(TERM_HELP),
    months: z.number().int().min(1).max(24).optional().describe("How many months of history to return with the latest figure, 1 to 24. Default 12."),
  },
  // Only these four things are ever read: anything else in the request is dropped here, so no personal detail can reach a source.
  prepare: (p) => {
    const product = str(p.product);
    const term = str(p.term);
    if (product && product.length > 40) throw new InputError("product must be one of mortgage, consumer_loan, business_loan, business_loan_small, business_loan_large, deposit, deposit_overnight, deposit_notice.");
    if (term && term.length > 20) throw new InputError("term must be a short code such as total, floating, fixed, 1-5y, over-5y or up-to-1y.");
    return { country: p.country, ...(product ? { product } : {}), ...(term ? { term } : {}), ...(p.months !== undefined && p.months !== null && p.months !== "" ? { months: p.months } : {}) };
  },
});
