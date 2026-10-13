// Manifest: Ireland home sales (Property Price Register). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { INFO, IE_TYPES, ieHarvest, ieHistoryKey, ieHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["IE"],
  countryHelp: "IE = Ireland (Property Price Register)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    town: "IE: give the county here (e.g. 'Dublin', 'Cork'); or use county. Omit both for all of Ireland.",
    property_type: "IE: any, new or second-hand.",
    months: "IE: always the latest 12 months.",
  },
  paramValues: { property_type: IE_TYPES.filter((t) => t !== "any") },
  extraParams: {
    county: z.string().optional().describe("IE only: county such as 'Dublin' or 'Cork'. Omit for all of Ireland."),
  },
  examples: [{ params: { country: "IE", county: "Dublin" } }],
  method:
    "Ireland (Property Price Register): the register is collected once a day into our price library; answers are the trailing 12 months by county, full-market-price sales only, prices including VAT.",
  handle: (p, ctx) => {
    if (p.property_type !== undefined && !(IE_TYPES as readonly string[]).includes(String(p.property_type).toLowerCase())) {
      throw new InputError(`property_type must be one of: ${IE_TYPES.join(", ")}`);
    }
    return ieHomeSales({ county: str(p.county) ?? str(p.town), property_type: str(p.property_type), baseUrl: ctx.baseUrl });
  },
  harvest: ieHarvest,
  historyKey: (p) => ieHistoryKey({ county: str(p.county) ?? str(p.town), property_type: str(p.property_type) }),
});
