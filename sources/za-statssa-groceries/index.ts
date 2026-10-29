// Manifest: South Africa grocery prices (Stats SA CPI average prices: monthly national average retail price in rand of everyday goods). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, zaGroceryPrices, zaHarvest, zaHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["ZA"],
  countryHelp: "ZA = South Africa (Stats SA: monthly average retail prices in rand of everyday goods, all urban areas)",
  placeName: "South Africa",
  status: "live",
  paramNotes: {
    item:
      "ZA: Stats SA's standard items and pack sizes, e.g. milk (1 l), eggs (18), white bread (700 g), butter (500 g), white rice (1 kg), sugar (1 kg), maize meal (5 kg), cooking oil (750 ml), whole chicken (per kg), beef mince, bananas, potatoes, tomatoes, coffee, beer.",
    region: "ZA: national all-urban averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "ZA", item: "milk" } },
    { params: { country: "ZA", item: "eggs" }, smoke: false },
  ],
  method:
    "South Africa (groceries): the national average retail price in rand of everyday goods in stated pack sizes that Stats SA publishes with its monthly Consumer Price Index, for all urban areas, with the change on a year earlier. We collect the newest file daily and pass on the published average and its month; it is an average compiled for price statistics, not receipts.",
  handle: (p, ctx) => zaGroceryPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: () => zaHarvest(),
  historyKey: (p) => zaHistoryKey({ item: str(p.item) }),
  referenceDates: true,
  nominalCounts: true,
});
