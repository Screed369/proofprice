// Manifest: New Zealand grocery prices (Stats NZ selected price indexes: monthly weighted average prices of 74 food items). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nzGroceryPrices, nzHarvest, nzHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (Stats NZ: national monthly weighted average prices of 74 food and drink items)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: {
    item:
      "NZ: Stats NZ's standard items, e.g. milk (2 l), eggs (dozen), butter (500 g), white bread (600 g), cheese (1 kg), beef mince, chicken breast, bananas, apples, potatoes, rice, flour, sugar, coffee.",
    region: "NZ: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "NZ", item: "milk" } },
    { params: { country: "NZ", item: "eggs" }, smoke: false },
  ],
  method:
    "New Zealand (groceries): the national monthly weighted average price of 74 standard food and drink items that Stats NZ publishes with its Selected price indexes release, with the change on a year earlier. We collect the newest release daily and pass on the published average and its month; it is an average compiled for price statistics, not receipts.",
  handle: (p, ctx) => nzGroceryPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => nzHarvest(),
  historyKey: (p) => nzHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
});
