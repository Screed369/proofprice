// Manifest: Malaysia PriceCatcher (DOSM) shop shelf prices of everyday goods. Logic lives in ./source.ts.
// The daily collector (harvest) reads the newest monthly file; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, pricecatcherHarvest, pricecatcherHistoryKey, pricecatcherPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["MY"],
  countryHelp: "MY = Malaysia",
  placeName: "Malaysia (shop shelf prices, DOSM PriceCatcher)",
  status: "live",
  paramNotes: {
    item:
      "MY: an everyday item in English or Malay ('chicken', 'eggs', 'rice', 'cooking oil', 'sugar', 'milk', 'onion', 'cabbage', 'ayam', 'telur'). DOSM names items in Malay with the pack size, " +
      "so the answer names the exact item and lists related ones. Only the 60 items priced in the most shops are held.",
    region: "MY: a state ('Selangor', 'Johor', 'Sabah', 'Penang', 'Kuala Lumpur'); leave out for the national figure. A state needs 5 or more shops pricing the item.",
  },
  examples: [
    { params: { country: "MY", item: "eggs" } },
    { params: { country: "MY", item: "chicken", region: "Selangor" }, smoke: false },
  ],
  method:
    "Malaysia (shop prices): DOSM's PriceCatcher survey, collected once a day into our price library; an answer is the median and range across shops of each shop's newest price for an item over the last 7 days of data, in ringgit. " +
    "Posted shelf prices recorded by DOSM staff, not receipts; DOSM warns they are not the consumer price index.",
  handle: (p, ctx) => pricecatcherPrices({ item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: pricecatcherHarvest,
  historyKey: (p) => pricecatcherHistoryKey({ item: str(p.item), region: str(p.region) }),
});
