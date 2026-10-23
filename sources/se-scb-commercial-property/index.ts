// Manifest: Sweden sold industrial real estate, average purchase price (Statistics Sweden, table TAB1158). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, seCommercialProperty } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["SE"],
  countryHelp: "SE = Sweden (official yearly average price of sold industrial property by county, per property)",
  placeName: "Sweden",
  status: "live",
  paramNotes: {
    town: "SE: a county ('Skåne', 'Stockholm', 'Västra Götaland', 'Östergötland'); leave out for the whole of Sweden. Counties, not towns.",
    postcode: "SE: not supported; give the county as town.",
    property_type: "SE: commercial (default) = sold industrial real estate (factories, petrol stations and workshops, warehouses). land is not available for Sweden.",
    months: "SE: ignored; the figures are yearly (latest year with at least 5 sales).",
  },
  examples: [
    { params: { country: "SE", town: "Skåne", property_type: "commercial" } },
    { params: { country: "SE" }, smoke: false },
  ],
  method:
    "Sweden: Statistics Sweden's yearly count and average purchase price of sold industrial properties (factories, petrol stations and workshops, warehouses) per county. The answer is the sales-weighted average of the three types for the latest year with at least 5 sales. A price per property, not per square metre, with no range.",
  handle: (p, ctx) => seCommercialProperty({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
});
