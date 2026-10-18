// Manifest: Canada farm-gate prices (Statistics Canada table 32-10-0077-01, monthly prices received by farmers, by province). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, caFarmPrices, exampleProducts } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["CA"],
  countryHelp: "CA = Canada (Statistics Canada: monthly average prices received by farmers, by province, official statistic, not a live price)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    product: `Canada: a crop or animal product in everyday words, e.g. ${exampleProducts(30)}. Prices are in Canadian dollars in Statistics Canada's own unit for each series (per metric tonne for grains and oilseeds, per hundredweight for cattle, hogs and potatoes, per kilolitre for milk, per dozen for eggs); the answer names the unit.`,
    region:
      "Canada: a province is required (Ontario, Quebec, Saskatchewan, Alberta, Manitoba, British Columbia, Nova Scotia, New Brunswick, Prince Edward Island, Newfoundland and Labrador). Statistics Canada publishes no Canada total in this table. A city such as Saskatoon is answered with its province. Not every product is published for every province.",
  },
  examples: [
    { params: { country: "CA", product: "wheat", region: "Saskatchewan" } },
    { params: { country: "CA", product: "milk", region: "Ontario" }, smoke: false },
    { params: { country: "CA", product: "hogs", region: "Quebec" }, smoke: false },
  ],
  method:
    "Canada (farm-gate prices): Statistics Canada's monthly average price received by farmers for crops and livestock in each province (table 32-10-0077-01), from its farm product price survey and administrative data. " +
    "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average, not a sale or a live price, and no range is calculated.",
  handle: (p, ctx) => caFarmPrices({ product: String(p.product ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
