// Manifest: Canada grocery and everyday prices (Statistics Canada table 18-10-0245-01, monthly average retail prices). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { INFO, caPricesHarvest, caPricesHistoryKey, caStatcanPrices, exampleItems } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["CA"],
  countryHelp: "CA = Canada (Statistics Canada: monthly average retail prices of 110 selected products, national and provincial, official statistic, not a live price)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    item: `Canada: Statistics Canada's 110 standard products, each in one standard size, e.g. ${exampleItems(14)}. Milk is published per 1, 2 and 4 litres (2 litres by default); the answer names the exact product and lists the other sizes.`,
    region:
      "Canada: leave out for the Canada average, or give a province (Ontario, BC, Quebec ...), Whitehorse (or Yukon) or Yellowknife (or Northwest Territories). A city such as Toronto is answered with its province's average. " +
      "The two territories start in September 2025 and lack some products.",
  },
  examples: [
    { params: { country: "CA", item: "milk" } },
    { params: { country: "CA", item: "eggs" } },
    { params: { country: "CA", item: "bread", region: "Ontario" }, smoke: false },
  ],
  method:
    "Canada (groceries): Statistics Canada's monthly average retail price of 110 selected products, derived from transaction data supplied by Canadian grocery retailers, for Canada, the provinces, Whitehorse and Yellowknife (table 18-10-0245-01). " +
    "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average, not a live or single-shop price, and no range is calculated.",
  handle: (p, ctx) => caStatcanPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so a Statistics Canada outage is answered from it (stale-if-error). Rows are dated by the
  // reference month and each is one published average (n is NO_COUNT, no record count).
  harvest: () => caPricesHarvest(),
  historyKey: (p) => caPricesHistoryKey({ item: str(p.item), region: str(p.region) }, [...new Set((readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area))]),
  referenceDates: true,
  nominalCounts: true,
});
