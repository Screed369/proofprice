// Manifest: FEWS NET market prices of staple foods (Kenya, Central America, Colombia and other food-insecure countries). Logic lives in ./source.ts.
// Answered live from the FEWS NET Data Warehouse (one country and one food per question); no daily collector.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, LISTED, fewsMarketPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: LISTED,
  countryHelp:
    "Countries as ISO codes: " + LISTED.map((c) => `${c} = ${COUNTRIES[c]}`).join(", ") +
    ". FEWS NET market prices of staple foods; a country or food with no recent prices from 5 or more markets answers 'no matches'.",
  placeName: "countries FEWS NET monitors (Kenya, Central America, Colombia, southern Africa)",
  status: "live",
  paramNotes: {
    item:
      "FEWS NET countries: a staple food in plain words ('maize', 'rice', 'beans', 'wheat flour', 'sugar', 'cooking oil', 'potato', 'tomato'). FEWS NET names foods its own way, e.g. 'Maize Grain (White)'; " +
      "the answer names the food and lists other definitions. Add 'wholesale' for wholesale prices, otherwise retail.",
    region: "FEWS NET countries: leave out. Figures are a spread across the country's markets.",
  },
  examples: [
    { params: { country: "KE", item: "maize" } },
    { params: { country: "GT", item: "beans" }, smoke: false },
  ],
  method:
    "FEWS NET countries (food): the FEWS NET Data Warehouse market-price series are queried live for one country and one food; an answer is the median and range across markets of each market's newest monthly price, in US dollars at FEWS NET's conversion. " +
    "Posted market prices, not receipts; the newest month in a country is often 1 to 3 months old and the answer says when. Free tier only.",
  handle: (p, ctx) => fewsMarketPrices({ country: String(p.country), item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
});
