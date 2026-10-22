// Outside check for Spain pump prices: our national roll-up of the day's station prices next to the European Commission Weekly Oil
// Bulletin figure for Spain on the same Monday (see lib/crosscheck.ts). Internal only: run weekly by scripts/crosscheck.ts.
import type { CrossCheck } from "../../lib/plugin";
import { fetchWob, WOB_PAGE, WOB_URL } from "../_crosscheck/feeds";

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: WOB_URL,
  releasePage: WOB_PAGE,
  publisher: "European Commission, DG Energy (Weekly Oil Bulletin)",
  statistic: "weighted mean",
  ourMeasure: "n-weighted mean of area medians",
  series: "Weekly Oil Bulletin 'Price developments 2005 onwards', sheet 'Prices with taxes', columns ES_price_with_tax_diesel and ES_price_with_tax_euro95 (EUR per 1000 l), newest Monday",
  cadence: "weekly",
  ours: "library",
  areas: [
    { label: "Spain, diesel", theirs: "ES/diesel", ours: { item: "diesel" } },
    { label: "Spain, petrol 95", theirs: "ES/petrol95", ours: { item: "petrol95" } },
  ],
  // Pilot (22 Oct 2026, two weeks): ours 0.2% to 1.7% above the Bulletin, steady week to week.
  tolerancePct: 1,
  expectedBiasPct: [0.2, 1.7],
  jumpPoints: 1.5,
  knownDifferences: [
    "We count each station once; the Bulletin is weighted by volume sold, and big supermarket and motorway stations sell more and are often cheaper, so ours is usually a little higher.",
    "The Bulletin is the price on Monday; ours is our snapshot of the same day (or the day before).",
    "Our 53 Spanish areas include the Canary Islands, Ceuta and Melilla; whether the Bulletin's figure does was not verified.",
  ],
  fetch: (ctx) => fetchWob(ctx, ["ES"], ["diesel", "petrol95"]),
};
