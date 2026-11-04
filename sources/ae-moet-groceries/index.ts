// Manifest: UAE essential-goods shelf prices (Ministry of Economy and Tourism platform). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, moetHarvest, moetHistoryKey, moetPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["AE"],
  countryHelp: "AE = United Arab Emirates",
  placeName: "United Arab Emirates",
  status: "beta",
  paramNotes: {
    item:
      "AE: one of the Ministry's 18 essential goods in English ('eggs', 'milk', 'rice', 'sugar', 'flour', 'chicken', 'bread', 'yogurt', 'chickpeas', 'lentils', 'canola oil', 'sunflower oil'). " +
      "The answer is the median and range of the posted shelf prices across about 13 outlets, per kg, per litre or per piece (egg), and names the commodity and related ones. No region option.",
  },
  examples: [{ params: { country: "AE", item: "eggs" } }, { params: { country: "AE", item: "basmati rice" }, smoke: false }],
  method:
    "United Arab Emirates (posted shelf prices): the Ministry of Economy and Tourism's Essential Goods Prices Platform, 18 essential goods x about 13 outlets, converted to a price per kg, litre or piece; median and 10th–90th percentile across outlets in dirhams. Posted prices, not receipts.",
  handle: (p, ctx) => moetPrices({ item: str(p.item), baseUrl: ctx.baseUrl }),
  harvest: moetHarvest,
  historyKey: (p) => moetHistoryKey({ item: str(p.item) }),
});
