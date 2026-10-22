// Manifest: Latvia grocery and everyday prices (CSB average retail prices of selected goods). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, lvCsbPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["LV"],
  countryHelp: "LV = Latvia (Central Statistical Bureau: national average shop prices of about 130 food and drink items, monthly)",
  placeName: "Latvia",
  status: "live",
  paramNotes: {
    item:
      "LV: the CSB's standard items, e.g. milk (1 l), bread (wheat, 1 kg; also rye bread), eggs (10), butter (1 kg), cheese (1 kg), chicken (1 kg), potatoes, apples, bananas, sugar, " +
      "coffee, tea bags, beer (1 l), wine (1 l), vodka.",
    region: "LV: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "LV", item: "milk" } },
    { params: { country: "LV", item: "rye bread" }, smoke: false },
  ],
  method:
    "Latvia (groceries): the national average shop price of standard food and drink items that the Central Statistical Bureau publishes every month (table PCC010m), with the change on a year earlier. We pass on the published average and its month; it is an average of shelf prices recorded for price statistics, not receipts.",
  handle: (p, ctx) => lvCsbPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
