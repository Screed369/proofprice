// Manifest: Switzerland monthly consumer prices of fruit, vegetables and potatoes (BLW / FOAG via LINDAS). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, chProducePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (Federal Office for Agriculture: monthly consumer list prices of about 60 fruit, vegetable and potato items, CHF per kg or piece)",
  placeName: "Switzerland",
  status: "live",
  paramNotes: {
    item: "CH: fruit, vegetables and potatoes only, e.g. tomatoes, apples, bananas, carrots, potatoes, cucumbers, lemons, strawberries, lettuce, mushrooms. Add 'organic' for the organic product. Milk, bread, meat and other groceries are not covered.",
    region: "CH: leave out for Switzerland, or D-CH (German-speaking), F-CH (French-speaking) or I-CH (Italian-speaking).",
  },
  extraParams: {
    organic: z.string().optional().describe("CH only: 'true' for the organic product where BLW lists one (not every item has an organic twin)."),
  },
  examples: [
    { params: { country: "CH", item: "tomatoes" } },
    { params: { country: "CH", item: "apples", region: "F-CH" }, smoke: false },
    { params: { country: "CH", item: "bananas", organic: "true" }, smoke: false },
  ],
  method:
    "Switzerland (fruit, vegetables, potatoes): the monthly consumer price that the Federal Office for Agriculture publishes (LINDAS / opendata.swiss) for a standard item, Switzerland or a language region, with the change on the previous month and a year earlier that we calculate from the published figures. A BLW list price, not a receipt and not a count of paid prices.",
  handle: (p, ctx) => chProducePrices({ item: str(p.item), region: str(p.region), organic: str(p.organic), baseUrl: ctx.baseUrl }),
});
