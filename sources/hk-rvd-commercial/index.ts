// Manifest: Hong Kong private offices, retail premises and flatted factories, average prices and rents (Rating and Valuation Department). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, hkCommercial } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (Rating and Valuation Department, yearly average price per m² of private offices, retail premises and flatted factories, official statistic)",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    town: "HK: required. Offices: a district (Central, Sheung Wan, Wan Chai, Causeway Bay, North Point, Quarry Bay, Tsim Sha Tsui, Mong Kok, Kwun Tong). Retail or factories: a region ('Hong Kong' for Hong Kong Island, 'Kowloon', 'New Territories').",
    postcode: "HK: not used (Hong Kong has no postcodes).",
    property_type: "HK: commercial (default) = private offices, retail premises and flatted factories; land is not available. Use premises to choose which.",
    months: "HK: ignored; the figures are yearly (newest year with a usable figure).",
  },
  extraParams: {
    premises: z.string().optional().describe("HK only: office (default when town is an office district), retail (default for a region) or factory (flatted factories)."),
    grade: z.string().optional().describe("HK offices only: A (default), B or C, the RVD office grade."),
    basis: z.string().optional().describe("HK only: price (default, average sale price per m²) or rent (average monthly rent per m²)."),
  },
  examples: [
    { params: { country: "HK", town: "Central", premises: "office", grade: "A" } },
    { params: { country: "HK", town: "Kowloon", premises: "retail" }, smoke: false },
  ],
  method:
    "Hong Kong: the Rating and Valuation Department's yearly average price per m² (or monthly rent per m²) of private offices by grade and district, and of retail premises and flatted factories by region, for the newest year with a usable figure, with the change on the year before. A published average: no range, no sample size.",
  handle: (p, ctx) => hkCommercial({ town: str(p.town), premises: str(p.premises), grade: str(p.grade), basis: str(p.basis), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
});
