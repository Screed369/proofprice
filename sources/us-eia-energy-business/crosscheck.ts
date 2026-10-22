// Outside check for US business electricity: our commercial-sector answer (read from EIA's Excel file) next to the Commercial column
// of the same table on EIA's web page, a different route (see lib/crosscheck.ts). A parsing check. Internal only.
import type { CrossCheck } from "../../lib/plugin";
import { defaultOurFigure } from "../../lib/crosscheck";
import { EIA_56A_PAGE, fetchEia56a } from "../_crosscheck/feeds";

const STATES = ["TX", "CA", "NY"];

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: EIA_56A_PAGE,
  releasePage: "https://www.eia.gov/electricity/monthly/",
  publisher: "U.S. Energy Information Administration (Electric Power Monthly)",
  statistic: "average",
  ourMeasure: "published average",
  series: "EIA Electric Power Monthly table 5.6.A (web page), Commercial column, newest month, cents per kWh, by state",
  cadence: "monthly",
  ours: "api",
  areas: STATES.map((s) => ({ label: `${s} business`, theirs: s, ours: { country: "US", sector: "business", energy: "electricity", state: s } })),
  tolerancePct: 0.05,
  expectedBiasPct: 0,
  jumpPoints: 0.05,
  samePeriod: true,
  knownDifferences: ["Same table by another route (web page against the Excel file this source reads): any gap means a parsing fault, a shifted column or a stale copy."],
  // Our answer is in US dollars per kWh; the published cents are in extra.cents_per_kwh.
  ourFigure: (a) => {
    const f = defaultOurFigure(a);
    const cents = Number((a.extra as any)?.cents_per_kwh);
    return f && Number.isFinite(cents) ? { ...f, value: cents } : null;
  },
  fetch: (ctx) => fetchEia56a(ctx, "commercial", STATES),
};
