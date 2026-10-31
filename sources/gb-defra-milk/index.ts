// Manifest: UK farm-gate milk price (Defra monthly statistics, Open Government Licence v3.0). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, gbMilkHarvest, gbMilkPrices, milkHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (Defra: monthly average price farmers received for milk, official statistic, not a shop price)",
  placeName: "the United Kingdom",
  status: "live",
  paramNotes: {
    product: "United Kingdom: only 'milk' (the monthly price UK dairy farmers received, in pence per litre; the answer gives pounds per litre and the pence figure).",
    region: "United Kingdom: not needed. Defra publishes one figure for the whole UK, so a nation such as 'Scotland' is answered with the UK average and a note.",
  },
  examples: [{ params: { country: "GB", product: "milk" } }],
  method:
    "United Kingdom (farm-gate milk): Defra's monthly UK milk price statistics, from its compulsory survey of dairies. We pass on the newest published month with the change on the month before and a year earlier; it is a monthly average price received by farmers, not a sale or a shop price, and no range is calculated.",
  handle: (p, ctx) => gbMilkPrices({ product: String(p.product ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so a gov.uk outage is answered from it (stale-if-error). The row is one published average (n is NO_COUNT).
  harvest: () => gbMilkHarvest(),
  historyKey: (p) => milkHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
