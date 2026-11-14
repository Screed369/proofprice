// Payment gate: which calls are premium, what they cost and how many are free. The ONE place to change prices.
// Prices approved by Simon on 20 Oct 2026 (from the Strategist's "Pricing research: AI-to-AI per call", 15 Oct 2026, section 7).
// Change them here (and in docs/payments.md); nothing else needs to move.
//
// Basic official-data answers (the 15 category tools, /api/v1/<category>, coverage) are NOT in this list and stay free: the
// discoverability plan depends on it. Bulk is not built yet, so it has no entry.

import { NAMED_APP_ALLOWANCE_FACTOR } from "../usage";

export type PremiumKey = "check" | "history" | "lookup";

export interface PremiumPrice {
  /** Price per call in USD cents-of-a-cent: millionths of a dollar (USDC has 6 decimals). 100_000 = USD 0.10. */
  microUsd: number;
  /** Free calls per caller per UTC day before the first 402. 0 means paid from the first call (the pay-first door, key "lookup"). */
  freePerDay: number;
  /** One line for tool descriptions and the 402 body. */
  label: string;
}

export const PREMIUM: Record<PremiumKey, PremiumPrice> = {
  // Price check with itemised analysis (pricepaid_check_price, GET /api/v1/check). USD 0.10.
  check: { microUsd: 100_000, freePerDay: 20, label: "price check with itemised analysis" },
  // Daily history from the price library (pricepaid_*_history, GET /api/v1/<category>/history). USD 0.02.
  history: { microUsd: 20_000, freePerDay: 10, label: "daily price history" },
  // The pay-first door (GET /api/v1/paid/<category>), a 14-day test approved by the owner on 14 Nov 2026. USD 0.01 from the first call,
  // no free allowance. It returns the normal answer plus the daily trend and, when a price is given, the price check. The plain look-up
  // at /api/v1/<category> is not touched and stays free.
  lookup: { microUsd: 10_000, freePerDay: 0, label: "paid look-up with trend" },
};

/** Safety cap on paid calls served per UTC day by one server instance (spend/abuse control). */
export const DAILY_PAID_CAP = 5_000;

/** Free calls a day for this tool for a caller that names its app (lib/usage.ts, NAMED_APP_ALLOWANCE_FACTOR times the plain allowance). */
export function freeAllowance(key: PremiumKey, namedApp: boolean): number {
  return PREMIUM[key].freePerDay * (namedApp ? NAMED_APP_ALLOWANCE_FACTOR : 1);
}
