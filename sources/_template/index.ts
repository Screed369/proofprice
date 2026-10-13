// TEMPLATE (ignored by the registry because the folder name starts with "_"). Copy the folder, then edit.
import { defineSource, str } from "../../lib/plugin";
import { INFO, exampleNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel", // a folder in categories/
  countries: ["XX"], // ISO 3166-1 alpha-2
  countryHelp: "XX = Exampleland",
  placeName: "Exampleland",
  status: "beta",
  paramNotes: { area: "XX: region code ('01')." },
  examples: [{ params: { country: "XX", area: "01", fuel: "diesel" } }],
  method: "Exampleland: one plain sentence on what is counted and what is left out.",
  handle: (p, ctx) => exampleNow({ area: str(p.area), fuel: String(p.fuel), baseUrl: ctx.baseUrl }),
  // harvest: exampleHarvest,   // optional: one day of aggregates for the price library
  // historyKey: (p) => ({ area: str(p.area) ?? "ALL", item: String(p.fuel), label: "region" }),
});
