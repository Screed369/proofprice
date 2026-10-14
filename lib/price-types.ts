// How each kind of price is called in words. One place, used by the website, the sources page and the tool descriptions.

import type { SourceInfo } from "./plugin";

export type PriceType = SourceInfo["price_type"];

/** Long label (sources page, tool descriptions). */
export const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  transaction: "Price actually paid (completed sale)",
  posted_pump_price: "Posted pump price (what the station displays; not a receipt)",
  posted_price: "Posted price (not a receipt)",
  contract_price: "Contract price",
  reimbursement_price: "Reimbursement price",
  official_statistic: "Official statistic (published average or median)",
};

/** Short label (tables, badges). */
export const PRICE_TYPE_SHORT: Record<PriceType, string> = {
  transaction: "Paid (completed sale)",
  posted_pump_price: "Posted pump price",
  posted_price: "Posted price",
  contract_price: "Contract price",
  reimbursement_price: "Reimbursement price",
  official_statistic: "Official statistic",
};

/** One sentence on what kind of price a page's figure is. */
export const PRICE_TYPE_BASIS: Record<PriceType, string> = {
  transaction: "Prices recorded in official records of completed sales. Asking prices are never used.",
  posted_pump_price: "Posted pump prices: what each filling station displays for a litre, as published in the official feed. They are not individual receipts.",
  posted_price: "Posted prices, as published by the official source. They are not individual receipts.",
  contract_price: "Contract prices, as published by the official source.",
  reimbursement_price: "Reimbursement prices set by the official source.",
  official_statistic: "An official average or median published by a statistics office or regulator, not individual sales.",
};
