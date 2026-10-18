// Manifest: WFP market food prices (staple foods in about 70 countries). Logic lives in ./source.ts.
// The daily collector (harvest) reads the two newest yearly WFP files from HDX; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, wfpFoodPrices, wfpHarvest, wfpHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". World Food Programme market surveys of staple foods; a country with no recent survey of 5 or more markets answers 'no matches'.",
  placeName: "countries WFP surveys (Africa, Asia, Middle East, Latin America)",
  status: "live",
  paramNotes: {
    item:
      "WFP countries: a staple food in plain words ('rice', 'wheat flour', 'maize', 'beans', 'sugar', 'cooking oil', 'milk', 'onions', 'tomatoes', 'chicken'). WFP names foods its own way, e.g. 'Rice (high quality)'; " +
      "the answer names the food and lists other definitions. Add 'wholesale' for wholesale prices, otherwise retail.",
    region: "WFP countries: leave out. Figures are a spread across the country's surveyed markets.",
  },
  examples: [
    { params: { country: "AF", item: "wheat" } },
    { params: { country: "IN", item: "rice" }, smoke: false },
  ],
  method:
    "WFP countries (food): the World Food Programme Price Database on HDX (market surveys in about 70 countries) is collected once a day into our price library; an answer is the median and range across markets of each market's newest price for a food, in US dollars at WFP's conversion. " +
    "Posted market-survey prices, not receipts; the newest survey in a country is often months old and the answer says when.",
  handle: (p, ctx) => wfpFoodPrices({ country: String(p.country), item: str(p.item), region: str(p.region), baseUrl: ctx.baseUrl }),
  harvest: wfpHarvest,
  historyKey: (p) => wfpHistoryKey({ country: String(p.country), item: str(p.item) }),
});
