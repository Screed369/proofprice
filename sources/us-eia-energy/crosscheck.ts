// Outside check for US household electricity: our answer (copied by the collector from EIA's Excel file) next to the same table read
// from EIA's web page, a different route (see lib/crosscheck.ts). It proves parsing (no shifted column, right state, right month),
// not EIA's survey. Internal only.
import type { CrossCheck } from "../../lib/plugin";
import { EIA_56A_PAGE, fetchEia56a } from "../_crosscheck/feeds";

const STATES = ["TX", "CA", "NY"];

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: EIA_56A_PAGE,
  releasePage: "https://www.eia.gov/electricity/monthly/",
  publisher: "U.S. Energy Information Administration (Electric Power Monthly)",
  statistic: "average",
  ourMeasure: "published average",
  series: "EIA Electric Power Monthly table 5.6.A (web page), Residential column, newest month, cents per kWh, by state",
  cadence: "monthly",
  ours: "api",
  areas: STATES.map((s) => ({ label: s, theirs: s, ours: { country: "US", energy: "electricity", state: s } })),
  tolerancePct: 0.05,
  expectedBiasPct: 0,
  jumpPoints: 0.05,
  samePeriod: true,
  knownDifferences: ["Same table by another route (web page against the Excel file our collector reads): any gap means a parsing fault, a shifted column or a stale copy."],
  fetch: (ctx) => fetchEia56a(ctx, "residential", STATES),
};
