// Manifest: France live pump prices. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { Fuel } from "../../lib/fuels";
import { INFO, FR_NAME, frFuelNow, frHarvest, frHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["FR"],
  countryHelp: "FR = France",
  placeName: "France",
  status: "live",
  paramNotes: {
    postcode: "FR: 5-digit postcode, e.g. '75015'.",
    area: "FR: department ('69', '2A').",
  },
  examples: [{ params: { country: "FR", postcode: "75015", fuel: "diesel" } }],
  handle: (p, ctx) => {
    const fr = FR_NAME[p.fuel as Fuel];
    if (!fr) throw new InputError(`Fuel '${p.fuel}' is not published for France.`);
    return frFuelNow({ postcode: str(p.postcode), department: str(p.department) ?? str(p.area), fuel: fr, baseUrl: ctx.baseUrl });
  },
  harvest: frHarvest,
  historyKey: (p) => frHistoryKey({ postcode: str(p.postcode), department: str(p.department) ?? str(p.area), fuel: String(p.fuel) }),
});
