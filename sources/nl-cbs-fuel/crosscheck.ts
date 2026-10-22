// Outside check for Netherlands pump prices: the CBS national average in our library next to the Weekly Oil Bulletin figure for the
// Netherlands on the same Monday (see lib/crosscheck.ts). The Netherlands reports the CBS figure to the Commission, so the two should
// be identical: this proves we read CBS's table correctly (a parsing check), not CBS's survey. Internal only.
import type { CrossCheck } from "../../lib/plugin";
import { fetchWob, WOB_PAGE, WOB_URL } from "../_crosscheck/feeds";

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: WOB_URL,
  releasePage: WOB_PAGE,
  publisher: "European Commission, DG Energy (Weekly Oil Bulletin)",
  statistic: "average",
  ourMeasure: "published average",
  series: "Weekly Oil Bulletin 'Price developments 2005 onwards', sheet 'Prices with taxes', columns NL_price_with_tax_diesel and NL_price_with_tax_euro95 (EUR per 1000 l), newest Monday",
  cadence: "weekly",
  ours: "library",
  areas: [
    { label: "Netherlands, diesel", theirs: "NL/diesel", ours: { item: "diesel" } },
    { label: "Netherlands, Euro95 petrol", theirs: "NL/petrol95", ours: { item: "petrol95" } },
  ],
  // 19 Oct 2026: CBS 2.456 / 2.391 against the Bulletin 2.45626 / 2.39074 (rounding only).
  tolerancePct: 0.5,
  expectedBiasPct: 0,
  jumpPoints: 0.5,
  knownDifferences: [
    "Same figure by another route: the Bulletin's Dutch price is the CBS daily average for the Monday, so only rounding should differ (CBS gives 3 decimals).",
  ],
  fetch: (ctx) => fetchWob(ctx, ["NL"], ["diesel", "petrol95"]),
};
