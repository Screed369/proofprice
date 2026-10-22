// Outside check for England & Wales home sales: our median of Land Registry sales next to the UK House Price Index average for the
// same local authority (see lib/crosscheck.ts and Notion "crossCheck design"). Internal only: run weekly by scripts/crosscheck.ts.
import type { CrossCheck } from "../../lib/plugin";
import { defaultOurFigure, spanMonths } from "../../lib/crosscheck";
import { fetchUkHpi, ukHpiUrl } from "../_crosscheck/feeds";

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: ukHpiUrl("Average-prices", "2026-08"), // the newest release is found by its month in the file name
  releasePage: "https://landregistry.data.gov.uk/app/ukhpi/",
  publisher: "HM Land Registry with the Office for National Statistics (UK House Price Index)",
  statistic: "average",
  ourMeasure: "median",
  series:
    "UK HPI monthly download Average-prices-<YYYY-MM>.csv, column Average_Price (all property types, not seasonally adjusted) for the local authority (Area_Code), newest month; " +
    "Sales-<YYYY-MM>.csv column Sales_Volume (mean of the newest 3 months with a volume) for the count",
  cadence: "monthly",
  ours: "api",
  areas: [
    { label: "Leeds", theirs: "E08000035", ours: { country: "GB", district: "Leeds", months: "6" } },
    { label: "City of Bristol", theirs: "E06000023", ours: { country: "GB", district: "Bristol", months: "6" } },
  ],
  // Their figure is an index-adjusted average (mean-like), ours a median of standard-price sales: a wide band, and the real alarm is a jump.
  tolerancePct: 8,
  expectedBiasPct: 0,
  jumpPoints: 4,
  knownDifferences: [
    "The UK HPI average price is a model figure (an index applied to a base average) and is revised for recent months; ours is the median of standard-price (category A) sales.",
    "We ask by council area (district), the same area as theirs; asking by town would give the Royal Mail postal town, which is wider or narrower (BRISTOL includes BS34 in South Gloucestershire).",
    "Recent months of the register are still filling up (sales are registered weeks to months later), so our sales per month run a little below theirs.",
    "Our window is the last 6 months of registered sales and at most 5,000 sales; their figure is one month, about two months back.",
  ],
  // Ours: sales per month over the span our answer really covers; theirs: Sales_Volume per month (the pilot's Bristol finding).
  // 22 Oct 2026 by district: Leeds 515 against 616 a month (0.84), City of Bristol 325 against 378 (0.86): registration lag.
  compareVolumes: { tolerancePct: 25, expectedRatio: [0.8, 1] },
  ourFigure: (a) => {
    const f = defaultOurFigure(a);
    if (!f || !a.sample_size || !a.period.from || !a.period.to) return f;
    return { ...f, n: Math.round(a.sample_size / spanMonths(a.period.from, a.period.to)) };
  },
  fetch: (ctx) => fetchUkHpi(ctx, ["E08000035", "E06000023"]),
};
