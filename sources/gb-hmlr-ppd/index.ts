// Manifest: England & Wales home sales (HM Land Registry Price Paid Data). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { findPlace } from "../gb-ukhpi/source";
import { INFO, ukHomeSales, UK_PROPERTY_TYPES, UkPropertyType } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["GB"],
  countryHelp: "GB = England & Wales (HM Land Registry)",
  placeName: "England & Wales",
  status: "live",
  // Scottish and Northern Irish places are answered by gb-ukhpi (England & Wales stay here).
  serves: (p) => findPlace(str(p.town)) === null,
  paramNotes: {
    town: "GB: required, e.g. 'Bristol'.",
    property_type: "GB: detached, semi-detached, terraced or flat-maisonette.",
  },
  paramValues: { property_type: ["detached", "semi-detached", "terraced", "flat-maisonette"] },
  extraParams: {
    postcode_district: z.string().optional().describe("GB only: postcode district such as 'BS8' to narrow the area."),
  },
  examples: [{ params: { country: "GB", town: "Bristol", property_type: "terraced" } }],
  method: "England & Wales: standard-price sales (category A) only; repossessions and transfers to companies are excluded.",
  handle: (p, ctx) => {
    const town = str(p.town);
    if (!town) throw new InputError("A town is required.");
    const pt = (str(p.property_type) ?? "any").toLowerCase();
    if (!UK_PROPERTY_TYPES.includes(pt as UkPropertyType)) {
      throw new InputError(`property_type must be one of: ${UK_PROPERTY_TYPES.join(", ")}`);
    }
    return ukHomeSales({
      town,
      postcode_district: str(p.postcode_district),
      property_type: pt as UkPropertyType,
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    });
  },
});
