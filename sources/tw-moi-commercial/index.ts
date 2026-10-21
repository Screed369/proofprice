// Manifest: Taiwan commercial property and land sales (Ministry of the Interior, actual price registration). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, twCommercial, twCommercialHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["TW"],
  countryHelp: "TW = Taiwan",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    town:
      "TW: a city or county in English or Chinese ('Taipei', 'New Taipei', 'Taichung', 'Kaohsiung', '臺北市'), or a district with its city (\"Zhongshan, Taipei\", '臺北市中山區'). Omit for all of Taiwan.",
    postcode: "TW: not supported (the register has no postcodes); give the city, county or district as town.",
    property_type: "TW: commercial (default; shops, offices, factories, per m² of building) or land (building plots without a building, per m² of land).",
    months: "TW: 12 or 24 whole calendar months; up to 18 gives 12 (24 if a place has too few sales in 12), more gives 24.",
  },
  examples: [
    { params: { country: "TW", town: "Taipei", property_type: "commercial" } },
    { params: { country: "TW", town: "Taipei", property_type: "land" }, smoke: false },
  ],
  method:
    "Taiwan: the Ministry of the Interior's actual price registration open data is read by our collector from the official releases; we keep the median and 10th–90th percentile of the unit price per m² (and, for commercial premises, of the whole price) for the last 12 and 24 whole months, per city or county and district, from market sales only (not relatives' deals, presales, government or other special cases), and answer from that copy.",
  handle: async (p, ctx) => twCommercial({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: twCommercialHarvest,
});
