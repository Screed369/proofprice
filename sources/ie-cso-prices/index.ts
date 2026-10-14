// Manifest: Ireland grocery and everyday prices (CSO average prices of selected consumer items). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, ieCsoPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "groceries",
  countries: ["IE"],
  countryHelp: "IE = Ireland (Central Statistics Office: national average shop prices of about 76 standard items, monthly)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    item:
      "IE: the CSO's standard items, e.g. milk (full-fat, 2 litres), white bread (800 g sliced pan), eggs (large, half dozen), butter (per lb), cheese (Irish cheddar), chicken (whole bird), bananas, potatoes, " +
      "sugar, tea bags, beer (can of lager), wine (75 cl), whiskey, pint of stout or lager (bar). The CSO has no coffee, mince or cereal.",
    region: "IE: national averages only; a region is ignored and the answer says so.",
  },
  examples: [
    { params: { country: "IE", item: "milk" } },
    { params: { country: "IE", item: "white bread" } },
  ],
  method:
    "Ireland (groceries): the national average shop price of standard consumer items that the Central Statistics Office publishes every month for the Consumer Price Index (table CPM12), with the change on a year earlier. We pass on the published average and its month; it is an average of shelf prices recorded by price collectors, not receipts.",
  handle: (p, ctx) => ieCsoPrices({ item: String(p.item ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
});
