// Manifest: Germany wholesale fruit and vegetables (BLE weekly market report). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, deWholesale } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["DE"],
  countryHelp: "DE = Germany (BLE weekly national wholesale-market quotations for fruit and vegetables, quoted not paid)",
  placeName: "Germany",
  status: "live",
  paramNotes: {
    product:
      "DE: fruit and vegetables on the German wholesale markets, in English or German: apples, pears, cucumbers, tomatoes, peppers, grapes, kiwis, plums, lemons, zucchini, oranges, mandarins, onions, aubergines, " +
      "strawberries, cauliflower, carrots, peaches, nectarines, bananas, lettuce, leeks, brussels sprouts and more (no potatoes). A variety such as 'elstar' also works. " +
      "The answer is the median of that week's national quotations in EUR per kg, with the cheapest and dearest quotation and the change on the previous week.",
  },
  examples: [
    { params: { country: "DE", product: "apples" } },
    { params: { country: "DE", product: "tomatoes" }, smoke: false },
    { params: { country: "DE", product: "Möhren" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => deWholesale({ product: str(p.product), baseUrl: ctx.baseUrl }),
});
