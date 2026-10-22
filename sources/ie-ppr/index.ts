// Manifest: Ireland home sales (Property Price Register). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { INFO, IE_TYPES, ieBackfill, ieHarvest, ieHistoryKey, ieHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["IE"],
  countryHelp: "IE = Ireland (Property Price Register)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    town: "IE: a county ('Cork') or Dublin postal district ('Dublin 6'). Omit for all of Ireland.",
    property_type: "IE: any, new or second-hand (new homes are usually recorded without VAT).",
    months: "IE: rounded to the nearest of 3, 6, 12, 24 or 36.",
  },
  paramValues: { property_type: IE_TYPES.filter((t) => t !== "any") },
  extraParams: {
    county: z.string().optional().describe("IE only: same as town; a county such as 'Dublin' or 'Cork'."),
  },
  examples: [
    { params: { country: "IE", town: "Dublin", property_type: "second-hand" } },
    { params: { country: "IE", town: "Dublin 6", months: "24" }, smoke: false },
  ],
  method:
    "Ireland (Property Price Register): the register is collected once a day into our price library; answers are rolling 3 to 36 month windows by county or Dublin postal district, full-market-price sales only. New homes are usually recorded without VAT.",
  handle: (p, ctx) => {
    if (p.property_type !== undefined && !(IE_TYPES as readonly string[]).includes(String(p.property_type).toLowerCase())) {
      throw new InputError(`property_type must be one of: ${IE_TYPES.join(", ")}`);
    }
    return ieHomeSales({ county: str(p.county), town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl });
  },
  harvest: ieHarvest,
  backfill: ieBackfill,
  historyKey: (p, o) => ieHistoryKey({ county: str(p.county), town: str(p.town), property_type: str(p.property_type), months: num(p.months) }, o),
});
