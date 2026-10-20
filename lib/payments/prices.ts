// Payment gate: which calls are premium, what they cost and how many are free. The ONE place to change prices.
// Prices approved by Simon on 20 Oct 2026 (from the Strategist's "Pricing research: AI-to-AI per call", 15 Oct 2026, section 7).
// Change them here (and in docs/payments.md); nothing else needs to move.
//
// Basic official-data answers (the 15 category tools, /api/v1/<category>, coverage) are NOT in this list and stay free: the
// discoverability plan depends on it. Bulk is not built yet, so it has no entry.

export type PremiumKey = "check" | "history";

export interface PremiumPrice {
  /** Price per call in USD cents-of-a-cent: millionths of a dollar (USDC has 6 decimals). 100_000 = USD 0.10. */
  microUsd: number;
  /** Free calls per caller per UTC day before the first 402. */
  freePerDay: number;
  /** One line for tool descriptions and the 402 body. */
  label: string;
}

export const PREMIUM: Record<PremiumKey, PremiumPrice> = {
  // Price check with itemised analysis (pricepaid_check_price, GET /api/v1/check). USD 0.10.
  check: { microUsd: 100_000, freePerDay: 20, label: "price check with itemised analysis" },
  // Daily history from the price library (pricepaid_*_history, GET /api/v1/<category>/history). USD 0.02.
  history: { microUsd: 20_000, freePerDay: 10, label: "daily price history" },
};

/** Safety cap on paid calls served per UTC day by one server instance (spend/abuse control). */
export const DAILY_PAID_CAP = 5_000;
