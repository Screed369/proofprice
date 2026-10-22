// Outside check for Ireland home sales: our rolling 12-month median of second-hand homes on the Property Price Register next to the
// CSO's rolling 12-month median for EXISTING dwellings (HPM07), like for like (see lib/crosscheck.ts). Internal only.
import type { CrossCheck } from "../../lib/plugin";
import { CSO_HPM07_PAGE, CSO_HPM07_URL, fetchCsoHpm07 } from "../_crosscheck/feeds";

// RPPI region codes in HPM07: single counties only (the CSO splits Cork and Galway into city and county; we do not).
const AREAS = [
  { label: "Dublin", theirs: "40", town: "Dublin" },
  { label: "Kildare", theirs: "51", town: "Kildare" },
  { label: "Longford", theirs: "22", town: "Longford" },
];

export const CROSS_CHECK: CrossCheck = {
  headlineUrl: CSO_HPM07_URL,
  releasePage: CSO_HPM07_PAGE,
  publisher: "Central Statistics Office (CSO), Ireland",
  statistic: "median",
  ourMeasure: "median",
  series: "CSO PxStat HPM07: HPM07C02 Moving 12 Month Median Sale Price, Dwelling Status 'Existing', Stamp Duty Event 'Filings', all buyer types, by RPPI region, newest month",
  cadence: "monthly",
  ours: "api",
  areas: AREAS.map((a) => ({ label: a.label, theirs: a.theirs, ours: { country: "IE", town: a.town, property_type: "second-hand", months: "12" } })),
  tolerancePct: 3,
  expectedBiasPct: 0,
  jumpPoints: 2,
  knownDifferences: [
    "The CSO headline mixes new homes (with VAT) and existing homes; we compare with its 'Existing' series only, like for like with our second-hand homes.",
    "The CSO counts market-based household purchases (filings); the register also holds non-household buyers at full market price.",
    "Our 12 months end at the newest register day; theirs end about two months earlier, so up to about 1% is timing.",
  ],
  fetch: (ctx) => fetchCsoHpm07(ctx, AREAS.map((a) => a.theirs)),
};
