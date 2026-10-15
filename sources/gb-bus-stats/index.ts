// Manifest: England and Wales heat pump installed cost (DESNZ Boiler Upgrade Scheme statistics). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, busHarvest, busTech, gbBus, notPublished } from "./source";

export default defineSource({
  info: INFO,
  category: "home-upgrades",
  countries: ["GB"],
  countryHelp: "GB = England and Wales for heat pumps (Boiler Upgrade Scheme statistics) and Great Britain for solar panels",
  placeName: "England and Wales (heat pumps)",
  status: "live",
  serves: (p) => p.measure === "heat_pump",
  paramNotes: {},
  extraParams: {
    technology: z.string().optional().describe("GB heat_pump: air_to_water (default), ground_source or biomass_boiler."),
  },
  examples: [
    { params: { country: "GB", measure: "heat_pump" } },
    { params: { country: "GB", measure: "heat_pump", technology: "ground_source" }, smoke: false },
  ],
  method:
    "England and Wales heat pumps: DESNZ publishes each quarter the median and quartiles of the installation cost that installers reported on the MCS certificate for homes that received a Boiler Upgrade Scheme grant. We pass the figure on with its quarter. It is the installer's reported cost, not a receipt or a quote, and no number of installations is published.",
  handle: (p, ctx) => {
    const measure = String(p.measure ?? "");
    if (measure !== "heat_pump") return Promise.resolve(notPublished(measure, ctx.baseUrl));
    return gbBus({ technology: str(p.technology), dwelling_type: str(p.dwelling_type), area: str(p.area), baseUrl: ctx.baseUrl });
  },
  nominalCounts: true,
  harvest: busHarvest,
  historyKey: (p) => {
    const t = busTech(str(p.technology));
    return { area: "EW", item: `${t}/median`, label: `England and Wales ${t.replace(/_/g, " ")}` };
  },
});
