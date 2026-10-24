// Manifest: Singapore grocery, hawker-meal and household prices (SingStat Average Retail Prices of Selected Consumer Items). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, sgSingstatPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["SG"],
  countryHelp: "SG = Singapore (Department of Statistics: national average prices of about 75 food, drink, hawker-meal and household items, monthly)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    item:
      "SG: the Department of Statistics' standard items, e.g. milk (1 l), eggs (10), bread (400 g), rice (5 kg), chicken (1 kg), pork, beef, salmon, prawns, bananas, cabbage, cooking oil, " +
      "sugar, beer (6 cans), and hawker plates such as chicken rice, char kway teow, wanton noodles, roti prata, kopi, teh.",
    region: "SG: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "SG", item: "chicken rice" } },
    { params: { country: "SG", item: "eggs" } },
  ],
  method:
    "Singapore (groceries): the national average price of standard food, drink, hawker-meal and household items that the Department of Statistics publishes every month (table M213761), with the change on a year earlier. We pass on the published average and its month; it is an average of prices recorded for the Consumer Price Index, not receipts.",
  handle: (p, ctx) => sgSingstatPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
