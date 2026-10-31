// Manifest: Czechia average purchase prices of flats and family houses per m2 (CZSO, annual official statistic). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, czHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CZ"],
  countryHelp: "CZ = Czechia (Czech Statistical Office: national average purchase price per square metre of flats and family houses, annual, CZK)",
  placeName: "Czechia (national average per m2)",
  status: "live",
  paramNotes: {
    town: "CZ: ignored; CZSO publishes one national figure per year (Prague and the regions are not available here). The answer says so.",
    postcode: "CZ: not supported (national average only).",
    property_type: "CZ: flat (default) or house (family house). Leave out for flats. Prices are CZK per square metre.",
    months: "CZ: ignored; the figure is annual (newest full calendar year).",
  },
  paramValues: { property_type: ["flat", "house"] },
  extraParams: {
    measure: z.string().optional().describe("Czechia only: leave out for the average price in CZK per m2 (this source); 'index' for the Eurostat house price index (2015 = 100) instead."),
  },
  examples: [
    { params: { country: "CZ" } },
    { params: { country: "CZ", property_type: "house" }, smoke: false },
  ],
  // The Eurostat index source (eu-home-price-index) also lists CZ: it only answers when asked for measure=index.
  serves: (p) => (str(p.measure) ?? "").toLowerCase() !== "index",
  method:
    "Czechia: the Czech Statistical Office's published average purchase price per square metre of flats and family houses (CZK), compiled from cadastre purchase records. We pass on the latest annual figure and its change over the year before; it is a national official statistic, with no range or sample size.",
  handle: (p, ctx) => czHomePrices({ property_type: str(p.property_type), town: str(p.town), baseUrl: ctx.baseUrl }),
});
