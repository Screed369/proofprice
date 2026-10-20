// Manifest: Hong Kong supermarket shelf prices (Consumer Council Online Price Watch via DATA.GOV.HK). Logic lives in ./source.ts.
// The daily collector (harvest) reads the feed once a day; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, pricewatchHarvest, pricewatchHistoryKey, pricewatchPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    item:
      "HK: a grocery category in English ('milk', 'eggs', 'rice', 'bread', 'honey', 'peanut butter', 'instant noodles', 'cooking oil', 'beer'). The answer is the median and range of shelf prices of the products in that category " +
      "(brands and pack sizes differ), per kg or per litre where the pack size is known, otherwise per pack; it names the category and lists related ones.",
    region: "HK: a supermarket chain ('Wellcome', 'ParknShop', 'Jasons', 'AEON'); leave out for all chains together. A chain needs 5 or more shelf prices in the category.",
  },
  examples: [
    { params: { country: "HK", item: "honey" } },
    { params: { country: "HK", item: "milk", region: "Wellcome" }, smoke: false },
  ],
  method:
    "Hong Kong (shelf prices): the Consumer Council's Online Price Watch file, collected once a day into our price library; an answer is the median and 10th–90th percentile of the shelf prices of the products in a category, in Hong Kong dollars. " +
    "Posted prices that the supermarkets report, not receipts.",
  handle: (p, ctx) => pricewatchPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: pricewatchHarvest,
  historyKey: (p) => pricewatchHistoryKey({ item: str(p.item), region: str(p.region) }),
});
