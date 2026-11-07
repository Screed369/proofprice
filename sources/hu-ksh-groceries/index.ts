// Manifest: Hungary grocery prices (KSH average consumer prices of selected products). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, huKshGroceries, huKshHarvest, huKshHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["HU"],
  countryHelp: "HU = Hungary (Hungarian Central Statistical Office KSH: national average shop prices of about 75 food and drink products, in HUF, monthly)",
  placeName: "Hungary",
  status: "live",
  paramNotes: {
    item:
      "HU: KSH's standard products, e.g. milk (1 l), bread (white, 1 kg), eggs (10), butter, cheese (1 kg), chicken (1 kg), pork, potatoes, apples, bananas, tomatoes, sugar, " +
      "flour, rice, coffee, beer (1 l), wine (1 l), vodka.",
    region: "HU: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "HU", item: "milk" } },
    { params: { country: "HU", item: "eggs" }, smoke: false },
  ],
  method:
    "Hungary (groceries): the national average shop price of standard food and drink products that the Hungarian Central Statistical Office (KSH) publishes every month (STADAT table 1.2.1.8), with the change on a year earlier. We pass on the published average and its month; it is an average of shelf prices recorded for price statistics, not receipts.",
  handle: (p, ctx) => huKshGroceries({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month so a KSH outage is answered from it (stale-if-error). Rows are dated by the reference month.
  harvest: () => huKshHarvest(),
  historyKey: (p) => huKshHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
  staleMaxDays: 45,
  noHistory: "Hungary: KSH publishes one national average per product and month; the last 13 months sit in extra.last_13_months of the live answer.",
});
