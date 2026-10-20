// Manifest: England and Wales wholesale fruit and vegetable prices (DEFRA). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, gbWholesale } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["GB"],
  countryHelp: "GB = England and Wales (DEFRA average wholesale prices of home-grown fruit and vegetables at the Birmingham, Bristol, Manchester and London markets, quoted not paid, about every two weeks)",
  placeName: "England and Wales",
  status: "live",
  paramNotes: {
    product:
      "GB: home-grown fruit and vegetables: apples (gala, bramley, cox...), pears, plums, strawberries, raspberries, blackberries, blueberries, cherries, gooseberries, currants, " +
      "carrots, onions, leeks, cauliflower, cabbage, calabrese, lettuce, tomatoes, cucumbers, courgettes, capsicum, beans, peas, beetroot, parsnips, swede, turnip, sprouts, celery, rhubarb, kale and more (no potatoes). " +
      "An item with several varieties gives the mean of the varieties and lists each; add the variety (for example 'gala apples') for one price. Prices are GBP per kg, per head, per twin pack or per stem; the answer names the unit and the date.",
  },
  examples: [
    { params: { country: "GB", product: "apples" } },
    { params: { country: "GB", product: "cauliflower" }, smoke: false },
    { params: { country: "GB", product: "strawberries" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => gbWholesale({ product: str(p.product), baseUrl: ctx.baseUrl }),
});
