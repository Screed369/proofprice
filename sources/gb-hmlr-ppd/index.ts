// Manifest: England & Wales home sales (HM Land Registry Price Paid Data). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { findPlace } from "../gb-ukhpi/source";
import { INFO, ukHomeSales, UK_PROPERTY_TYPES, UkPropertyType } from "./source";
import { CROSS_CHECK } from "./crosscheck";
import { gbBackfill, gbHarvest, gbHistoryKey } from "./history";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["GB"],
  countryHelp: "GB = England & Wales (HM Land Registry)",
  placeName: "England & Wales",
  status: "live",
  // Outside check against the publisher's headline figure (internal, never shown): ./crosscheck.ts
  crossCheck: CROSS_CHECK,
  // Scottish and Northern Irish places are answered by gb-ukhpi (England & Wales stay here).
  serves: (p) => findPlace(str(p.town)) === null,
  paramNotes: {
    town:
      "GB: the Royal Mail POSTAL TOWN as the Land Registry files it, e.g. 'Bristol'. It can be wider than the council area: 'Bristol' also takes in Bradley Stoke and Filton (South Gloucestershire), and every London sale is filed under 'London', so a London borough such as 'Camden' is not a town. For a council area or London borough use district. Give town or district.",
    property_type: "GB: detached, semi-detached, terraced or flat-maisonette.",
  },
  paramValues: { property_type: ["detached", "semi-detached", "terraced", "flat-maisonette"] },
  extraParams: {
    postcode_district: z.string().optional().describe("GB only: postcode district such as 'BS8' to narrow the area."),
    district: z
      .string()
      .optional()
      .describe(
        "GB only: local authority (council area or London borough) as the Land Registry records it, e.g. 'Camden', 'City of Bristol', 'South Gloucestershire'. Use it instead of town for a London borough or when the postal town is wider than the place you mean.",
      ),
  },
  // Monthly history since 1995 (History backfill, streamed from the yearly Price Paid files). The daily collector keeps only the newest whole month
  // per council (all homes) and for England & Wales, dated by that month, as the stale-if-error copy when the SPARQL endpoint is down.
  backfill: (from, to) => gbBackfill(from, to),
  harvest: () => gbHarvest(),
  referenceDates: true,
  historyKey: (p, o) =>
    gbHistoryKey({ town: str(p.town), district: str(p.district), property_type: str(p.property_type), postcode_district: str(p.postcode_district) }, o),
  examples: [{ params: { country: "GB", town: "Bristol", property_type: "terraced" } }],
  method: "England & Wales: standard-price sales (category A) only; repossessions and transfers to companies are excluded.",
  handle: (p, ctx) => {
    const town = str(p.town);
    const district = str(p.district);
    if (!town && !district) throw new InputError("A town is required (or give a district, e.g. district=Camden).");
    const pt = (str(p.property_type) ?? "any").toLowerCase();
    if (!UK_PROPERTY_TYPES.includes(pt as UkPropertyType)) {
      throw new InputError(`property_type must be one of: ${UK_PROPERTY_TYPES.join(", ")}`);
    }
    return ukHomeSales({
      town,
      district,
      postcode_district: str(p.postcode_district),
      property_type: pt as UkPropertyType,
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    });
  },
});
