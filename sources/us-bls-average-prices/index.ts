// Manifest: United States grocery and everyday prices (BLS CPI average price data). Logic lives in ./source.ts.
// The daily collector (harvest) copies the BLS flat file into the price library; requests are answered from the library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, usBlsPrices, usHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["US"],
  countryHelp: "US = United States (Bureau of Labor Statistics: average retail prices of about 45 standard food and drink items, monthly, national and four regions)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    item:
      "US: the BLS's standard items, e.g. eggs (grade A large, per dozen), milk (whole, per gallon), bread (white pan bread, per lb), butter, cheddar cheese, chicken, ground beef, steak, bacon, bananas, oranges, " +
      "potatoes, tomatoes, rice, pasta, flour, sugar, coffee (ground, per lb), soft drinks, beer, wine, ice cream. BLS has no tea or apples (dropped) and publishes most items per pound.",
    region: "US: leave out for the U.S. city average, or give northeast, midwest, south or west (a US state maps to its region). BLS publishes no state or city averages for food.",
  },
  examples: [
    { params: { country: "US", item: "eggs" } },
    { params: { country: "US", item: "coffee" } },
  ],
  method:
    "United States (groceries): the average retail price of standard food and drink items that the Bureau of Labor Statistics calculates every month from the store prices its collectors record for the Consumer Price Index (series APU), " +
    "for the U.S. city average and four regions, with the change on a year earlier. We copy the BLS file once a day and pass on the published average and its month; no range is calculated, and these are shelf prices, not receipts.",
  nominalCounts: true,
  harvest: usHarvest,
  handle: (p, ctx) => usBlsPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
