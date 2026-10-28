// Manifest: Austria grocery prices (STATISTIK AUSTRIA Preisradar: monthly median scanner-data prices of 100 food items). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, atGroceryPrices, atHarvest, atHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["AT"],
  countryHelp: "AT = Austria (STATISTIK AUSTRIA Preisradar: national monthly median prices of 100 food items from retail scanner data)",
  placeName: "Austria",
  status: "live",
  paramNotes: {
    item:
      "AT: STATISTIK AUSTRIA's standard items, e.g. milk, eggs, butter, bread, rice, flour, pasta, potatoes, apples, bananas, tomatoes, chicken breast, minced meat, gouda, coffee, olive oil; German names (Milch, Eier, Butter, Semmel) are not needed, use English words.",
    region: "AT: national figures only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "AT", item: "milk" } },
    { params: { country: "AT", item: "eggs" }, smoke: false },
  ],
  method:
    "Austria (groceries): the monthly median price of 100 standard food items that STATISTIK AUSTRIA computes from retailers' scanner data after discounts and publishes in its Preisradar, with the change on a year earlier. The 25th-75th percentile range it also publishes is shown separately. We pass on the published figure and its month; it is a statistic compiled from scanner data, not receipts.",
  handle: (p, ctx) => atGroceryPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => atHarvest(),
  historyKey: (p) => atHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
});
