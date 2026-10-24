// Manifest: United States commercial premises and vacant land sales, New York City only (NYC Department of Finance rolling sales).
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, usNycCommercial } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["US"],
  countryHelp: "US = United States, New York City only",
  placeName: "New York City",
  status: "live",
  paramNotes: {
    town: "US: a New York City borough ('Manhattan', 'Brooklyn') or neighborhood ('Midtown East', 'SoHo'); omit for the whole city, or use postcode.",
    postcode: "US: 5-digit New York City ZIP code, e.g. '10017'.",
    property_type: "US: commercial (default; offices, stores, lofts, factories, garages, warehouses) or land (commercial vacant land).",
    months: "US: up to 12 months (the city's file holds the last 12).",
  },
  examples: [
    { params: { country: "US", town: "Manhattan", property_type: "commercial" } },
    { params: { country: "US", postcode: "10017", property_type: "commercial" }, smoke: false },
  ],
  method:
    "US (New York City only): price per m² of tax class 4 sales (offices, stores, lofts, factories, garages, warehouses, or commercial vacant land) in the Department of Finance Rolling Calendar Sales file, last 12 months; nominal transfers dropped; condo units excluded; never addresses.",
  handle: (p, ctx) =>
    usNycCommercial({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
});
