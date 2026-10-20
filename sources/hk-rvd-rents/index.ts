// Manifest: Hong Kong rents (Rating and Valuation Dept, private domestic average rents by class). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, hkRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (Rating and Valuation Department, average rents of private domestic flats by class and region, official statistic)",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    town: "HK: required. A region: 'Hong Kong' (Hong Kong Island), 'Kowloon' or 'New Territories'; a known district such as Mong Kok, Central or Sha Tin gives its region's figure.",
    postcode: "HK: not used (Hong Kong has no postcodes); give a region.",
    property_type: "HK: ignored; private domestic flats only. Use flat_class for the size.",
    bedrooms: "HK: ignored; the RVD groups flats by saleable area. Use flat_class (A under 40 m², B 40–69.9, C 70–99.9, D 100–159.9, E 160+). Default B.",
    months: "HK: ignored; the answer is the newest usable month, with the last 12 months in extra.",
    house_type: "HK: not used.",
  },
  extraParams: {
    flat_class: z.string().optional().describe("HK only: RVD flat class by saleable area, A (under 40 m²), B (40–69.9), C (70–99.9), D (100–159.9) or E (160 and over). Default B."),
  },
  examples: [
    { params: { country: "HK", town: "Kowloon", flat_class: "B" } },
    { params: { country: "HK", town: "Hong Kong", flat_class: "A" }, smoke: false },
  ],
  method:
    "Hong Kong rents: the average monthly rent per square metre of saleable area of private domestic flats from the Rating and Valuation Department, for the region and flat class asked, with the change on a year earlier. " +
    "It is a published average, not a list of rents and not an asking rent; no range is calculated.",
  handle: (p, ctx) => hkRents({ town: str(p.town), flat_class: str(p.flat_class), baseUrl: ctx.baseUrl }),
});
