// Manifest: Taiwan, Taichung City public retail market posted prices of everyday foods. Logic lives in ./source.ts.
// The daily collector (harvest) reads the city's one JSON file; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, taichungHarvest, taichungHistoryKey, taichungPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Taichung City markets only)",
  placeName: "Taiwan (Taichung City markets)",
  status: "live",
  paramNotes: {
    item:
      "TW: an everyday food in English or Chinese ('eggs', 'pork loin', 'pork belly', 'cabbage', 'garlic', 'banana', 'milkfish', 'shrimp', '雞蛋', '蒜頭'). About 60 vegetables, fruit, fish, pork, beef, poultry and eggs " +
      "are held; the answer names the product and lists related ones. Prices are NT$ per kg from the public retail markets of Taichung City only.",
    region: "TW: not used; every figure is for Taichung City as a whole.",
  },
  examples: [
    { params: { country: "TW", item: "eggs" } },
    { params: { country: "TW", item: "pork belly" }, smoke: false },
  ],
  method:
    "Taiwan (Taichung markets): the city's daily public retail market price list, collected once a day into our price library; an answer is the median and range of the market-day average prices of the last 14 days, in NT$ per kg " +
    "(published per catty, converted). Posted market prices, not receipts; one city.",
  handle: (p, ctx) => taichungPrices({ item: str(p.item), baseUrl: ctx.baseUrl }),
  harvest: taichungHarvest,
  historyKey: (p) => taichungHistoryKey({ item: str(p.item) }),
});
