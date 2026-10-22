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
    { label: "Leeds", theirs: "E08000035", ours: { country: "GB", town: "Leeds", months: "6" } },
    { label: "Bristol", theirs: "E06000023", ours: { country: "GB", town: "Bristol", months: "6" } },
  ],
  // Their figure is an index-adjusted average (mean-like), ours a median of standard-price sales: a wide band, and the real alarm is a jump.
  tolerancePct: 8,
  expectedBiasPct: 0,
  jumpPoints: 4,
  knownDifferences: [
    "The UK HPI average price is a model figure (an index applied to a base average) and is revised for recent months; ours is the median of standard-price (category A) sales.",
    "Our town is the Royal Mail postal town (BRISTOL includes BS34 in South Gloucestershire); theirs is the local authority, so the counts can differ even when prices agree.",
    "Our window is the last 6 months of registered sales and at most 5,000 sales; their figure is one month, about two months back.",
  ],
  // Ours: sales per month over the span our answer really covers; theirs: Sales_Volume per month. The pilot's Bristol finding.
  compareVolumes: { tolerancePct: 30 },
  ourFigure: (a) => {
    const f = defaultOurFigure(a);
    if (!f || !a.sample_size || !a.period.from || !a.period.to) return f;
    return { ...f, n: Math.round(a.sample_size / spanMonths(a.period.from, a.period.to)) };
  },
  fetch: (ctx) => fetchUkHpi(ctx, ["E08000035", "E06000023"]),
};
