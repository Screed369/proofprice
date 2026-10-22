// Manifest: Canada wholesale fresh fruit and vegetable prices (Agriculture and Agri-Food Canada weekly file). Logic lives in ./source.ts.
// The daily collector (harvest) downloads AAFC's 55-week file once and keeps the newest week per centre and commodity; requests are answered from the library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, caAafc, caAafcHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["CA"],
  countryHelp: "CA = Canada (AAFC weekly wholesale asking prices of fresh fruit and vegetables at Calgary, Edmonton, Vancouver and Winnipeg, quoted not paid)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    product:
      "CA: fresh fruit and vegetables such as apples, bananas, grapes, avocados, carrots, cabbage, cucumbers, celery, broccoli, cauliflower, beets, garlic, ginger, blueberries and Chinese vegetables. " +
      "The answer is the median CAD per kg of the week's wholesale asking quotes with the 10th to 90th percentile and the number of quotes; add market=Calgary, Edmonton, Vancouver or Winnipeg for one centre.",
  },
  extraParams: {
    market: z.string().optional().describe("CA only: one wholesale centre (Calgary, Edmonton, Vancouver or Winnipeg). Leave out for all centres together. AAFC does not quote every centre every week (the latest file has only Calgary and Winnipeg); an unquoted centre answers with the list of centres that are quoted."),
  },
  examples: [
    { params: { country: "CA", product: "apples" } },
    { params: { country: "CA", product: "carrots", market: "Calgary" } },
  ],
  method: METHOD,
  harvest: caAafcHarvest,
  handle: (p, ctx) => caAafc({ product: str(p.product), market: str(p.market), baseUrl: ctx.baseUrl }),
});
