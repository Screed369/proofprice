// Manifest: Australia domestic airfares (BITRE cheapest advertised return fare by route, data.gov.au). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, auAirfares, auAirfaresHarvest, auAirfaresHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "flights",
  countries: ["AU"],
  countryHelp: "AU = Australia (domestic routes between about 70 city pairs; cheapest advertised return fare, not a fare paid)",
  placeName: "Australia (domestic routes)",
  status: "live",
  paramNotes: {
    from: "AU: city or airport code (Sydney, SYD, 'Gold Coast', OOL). Required, and AU also needs 'to'.",
    to: "AU: city or airport code. Required for AU (the answer is for one route, either direction).",
    quarters: "AU: the range covers this many quarters of monthly fares (default 4 = 12 months; at least 2 are needed for a range). AU publishes one cheapest advertised return fare per route per month: advertised, not paid, so the price type is posted_price.",
  },
  examples: [
    { params: { country: "AU", from: "Sydney", to: "Melbourne" } },
    { params: { country: "AU", from: "BNE", to: "PER", quarters: "8" }, smoke: false },
  ],
  method:
    "AU: the median and 10th-90th percentile of the monthly cheapest advertised return fares (AUD) for one domestic route over the last months, from the Bureau of Infrastructure and Transport Research Economics. Each month is one observation, collected from airline websites 3 weeks before departure. Advertised fares, not fares paid.",
  handle: (p, ctx) => auAirfares({ from: str(p.from), to: str(p.to), quarters: num(p.quarters), baseUrl: ctx.baseUrl }),
  // A daily copy of the default 12-month range per route, so a data.gov.au outage is answered from it (stale-if-error).
  // Rows are dated by the newest month they cover.
  harvest: () => auAirfaresHarvest(),
  historyKey: (p) => auAirfaresHistoryKey({ from: str(p.from), to: str(p.to), quarters: num(p.quarters) }),
  referenceDates: true,
});
