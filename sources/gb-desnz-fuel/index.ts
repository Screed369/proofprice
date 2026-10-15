// Manifest: United Kingdom national average pump prices (DESNZ weekly road fuel prices). Logic lives in ./source.ts.
// Answers come from the price library, filled by the collector from the weekly CSV on gov.uk.
import { defineSource, str } from "../../lib/plugin";
import { INFO, desnzFuelNow, desnzHarvest, desnzHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (DESNZ weekly national average pump prices of unleaded petrol and diesel)",
  placeName: "the United Kingdom (national averages)",
  status: "live",
  paramNotes: {
    fuel: "GB: petrol95 (unleaded petrol, ULSP) or diesel (ULSD) only, as a national average in pounds per litre; other fuels are not published.",
    postcode: "GB: not used; DESNZ publishes one UK average, so the national figure is returned and says so.",
    area: "GB: not used (national average only).",
    town: "GB: not used (national average only).",
    service: "GB: not used.",
  },
  examples: [
    { params: { country: "GB", fuel: "diesel" } },
    { params: { country: "GB", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "United Kingdom: the collector reads DESNZ's weekly road fuel prices table on gov.uk into our price library each day; answers are the average UK pump price of unleaded petrol or diesel that DESNZ publishes for the newest week, in pounds per litre, with the change on the previous week and a year earlier. An official national average, not a range of station prices.",
  handle: (p, ctx) =>
    desnzFuelNow({
      fuel: String(p.fuel),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      postcode: str(p.postcode),
      baseUrl: ctx.baseUrl,
    }),
  nominalCounts: true,
  harvest: desnzHarvest,
  historyKey: (p) => desnzHistoryKey({ fuel: String(p.fuel) }),
});
