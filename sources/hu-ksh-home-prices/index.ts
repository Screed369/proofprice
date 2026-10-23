// Manifest: Hungary home prices (KSH, official average price per m² by region and settlement type). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, huHomePrices } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["HU"],
  countryHelp: "HU = Hungary (official KSH average price per m² of used and new dwellings, annual, by region and settlement type; with no town the Eurostat house price index answers)",
  placeName: "Hungary",
  status: "live",
  paramNotes: {
    town: "HU: 'Budapest', a statistical region ('Pest', 'Central Transdanubia', 'Western Transdanubia', 'Southern Transdanubia', 'Northern Hungary', 'Northern Great Plain', 'Southern Great Plain') or a county or big city that names one ('Debrecen', 'Győr', 'Pécs', 'Szeged'), or 'Hungary'. A town is answered at the level of its region. Without a town the Eurostat price index answers instead.",
    postcode: "HU: not supported (KSH publishes regions, not postcodes).",
    property_type: "HU: 'existing' (used dwellings, the default) or 'new' (newly built). The figure is an average price per m² of living space.",
    months: "HU: ignored; KSH publishes one figure per calendar year (the latest is returned).",
  },
  paramValues: { property_type: ["existing", "new"] },
  extraParams: {
    settlement: z.string().optional().describe("HU only: type of settlement inside a region: all (default), county_seat, towns or villages. Budapest has one figure."),
  },
  examples: [
    { params: { country: "HU", town: "Budapest" } },
    { params: { country: "HU", town: "Szeged", property_type: "new", settlement: "county_seat" }, smoke: false },
  ],
  // Without a town the Eurostat index (eu-home-price-index) keeps answering Hungary; with a town this KSH table answers.
  serves: (p) => !!str(p.town),
  method:
    "Hungary: the average price per m² of used and of new dwellings that KSH publishes once a year for Budapest, the seven statistical regions and Hungary, split by settlement type, from the tax authority's records of sale contracts. We pass on the latest published year with the change on the year before; it is an average per m², not a price per home.",
  handle: (p, ctx) =>
    huHomePrices({ town: str(p.town), property_type: str(p.property_type), settlement: str(p.settlement), baseUrl: ctx.baseUrl }),
});
