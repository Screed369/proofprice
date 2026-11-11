// Manifest: Czechia grocery prices (CZSO monthly average consumer prices of selected goods, scanner data). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, czGroceries, czHarvest, czHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["CZ"],
  countryHelp: "CZ = Czechia (Czech Statistical Office CZSO: national monthly average consumer price of about 60 defined foods and drinks, in CZK, from retail scanner data)",
  placeName: "Czechia",
  status: "live",
  paramNotes: {
    item:
      "CZ: CZSO's defined products, e.g. milk (litre), bread (kg), eggs (per 10), butter (kg), cheese (Edam, kg), chicken (kg), pork (kg), beef (kg), potatoes, apples, bananas, tomatoes, " +
      "sugar, flour, rice, coffee, beer (0.5 l bottle), wine, vodka, sunflower/vegetable oil.",
    region: "CZ: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "CZ", item: "milk" } },
    { params: { country: "CZ", item: "eggs" }, smoke: false },
  ],
  method:
    "Czechia (groceries): the national average consumer price per month of about 60 defined food and drink products, computed by the Czech Statistical Office from retail scanner data (table CEN0101NT01). We pass on the published average and its month; it is a statistic, not a receipt or the price at one shop.",
  handle: (p, ctx) => czGroceries({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => czHarvest(),
  historyKey: (p) => czHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
  staleMaxDays: 45,
});
