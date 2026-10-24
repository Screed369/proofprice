// Manifest: France grocery prices (INSEE Prix moyens de vente au détail: national average retail prices of selected food items). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, frGroceryPrices, frHarvest, frHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["FR"],
  countryHelp: "FR = France (INSEE: national average retail prices of selected fresh food items, metropolitan France)",
  placeName: "France",
  status: "live",
  paramNotes: {
    item:
      "FR: INSEE's standard fresh items, e.g. apples, potatoes, carrots, beef (T-bone steak), monkfish, sole, shrimps; yearly figures for beef fillet and rump, pork roast, rabbit, oysters (dozen), lemons, oranges, green beans. French words work too (pommes, crevettes, huîtres).",
    region: "FR: national averages for metropolitan France only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "FR", item: "apples" } },
    { params: { country: "FR", item: "oysters" }, smoke: false },
  ],
  method:
    "France (groceries): the national average retail price of selected fresh food items from INSEE's price survey in metropolitan France, monthly for fruit, vegetables, beef, fish and shrimps and yearly for a few more, with the change on a year earlier. We collect the newest figures daily and pass on the published average and its period; it is an average compiled for price statistics, not receipts.",
  handle: (p, ctx) => frGroceryPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => frHarvest(),
  historyKey: (p) => frHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
});
