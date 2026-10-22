// Manifest: France wholesale fruit and vegetable prices (FranceAgriMer RNM). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, frWholesale } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["FR"],
  countryHelp: "FR = France (FranceAgriMer RNM quotes of fruit and vegetables at producer markets, dispatch, import and wholesale, EUR excluding VAT per kg, quoted not paid, daily)",
  placeName: "France",
  status: "live",
  paramNotes: {
    product:
      "FR: fruit and vegetables, English or French names: carrot, tomato, potato, onion, leek, cabbage, cauliflower, courgette, lettuce, apple, pear, orange, strawberry, peach, grape and about 60 more. " +
      "The answer is the median of the quoted average prices per kg across the market lines of the last 7 days (retail, organic and bunch lines left out), with the lowest and highest quote and the markets.",
  },
  examples: [
    { params: { country: "FR", product: "carrot" } },
    { params: { country: "FR", product: "apple" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => frWholesale({ product: str(p.product), baseUrl: ctx.baseUrl }),
});
