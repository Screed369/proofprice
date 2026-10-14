// Manifest: Taiwan rents (Ministry of the Interior, actual price registration, rentals). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, twRents, twRentsHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Ministry of the Interior actual price registration of rentals: every declared residential tenancy, summarised by city or county and district)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    town:
      "TW: a city or county in English or Chinese ('Taipei' / '台北市' / '臺北市', 'New Taipei', 'Taichung', 'Kaohsiung', 'Tainan', 'Taoyuan', 'Hsinchu City', 'Hsinchu County'), or a district with its city (\"Da'an, Taipei\", '臺北市大安區', 'Banqiao, New Taipei'). Omit for all of Taiwan. A district name used in several cities ('Zhongzheng', 'Dongqu') needs the city too.",
    postcode: "TW: not supported (the register has no postcodes); give the city, county or district as town.",
    property_type:
      "TW: any (whole homes and self-contained studios), apartment, house (透天厝) or room (a room let separately in a shared home: 分租套房, 分租雅房; kept apart from every other figure).",
    house_type: "TW: not available (the register does not say detached / semi-detached / terraced); use property_type house.",
    bedrooms: "TW: 0 (studio or open-plan) to 4; 5 means five or more. Leave out for all sizes. Not for rooms.",
    months: "TW: 12 or 24 whole calendar months; up to 18 gives 12 (24 if a place has too few tenancies in 12), more gives 24. The window ends at the last month that is at least 30 days old.",
  },
  examples: [
    { params: { country: "TW", town: "Taipei" } },
    { params: { country: "TW", town: "Da'an, Taipei", bedrooms: "1" }, smoke: false },
    { params: { country: "TW", town: "Kaohsiung", property_type: "apartment" }, smoke: false },
  ],
  pages: [
    { params: { country: "TW", town: "Taipei" }, label: "Taipei", question: "What is the rent for a home in Taipei, Taiwan?" },
    { params: { country: "TW", town: "Da'an, Taipei" }, label: "Da'an, Taipei", question: "What is the rent for a home in Da'an District, Taipei?" },
    { params: { country: "TW", town: "New Taipei" }, label: "New Taipei", question: "What is the rent for a home in New Taipei City?" },
    { params: { country: "TW", town: "Taoyuan" }, label: "Taoyuan", question: "What is the rent for a home in Taoyuan, Taiwan?" },
    { params: { country: "TW", town: "Hsinchu City" }, label: "Hsinchu City", question: "What is the rent for a home in Hsinchu City, Taiwan?" },
    { params: { country: "TW", town: "Taichung" }, label: "Taichung", question: "What is the rent for a home in Taichung, Taiwan?" },
    { params: { country: "TW", town: "Tainan" }, label: "Tainan", question: "What is the rent for a home in Tainan, Taiwan?" },
    { params: { country: "TW", town: "Kaohsiung" }, label: "Kaohsiung", question: "What is the rent for a home in Kaohsiung, Taiwan?" },
  ],
  method:
    "Taiwan: the Ministry of the Interior's actual price registration open data (every declared residential tenancy, with its monthly rent) is read by our collector from the official releases; we keep the median and 10th–90th percentile of the monthly rent and of the rent per m² for the last 12 and 24 whole months, per city or county, district, kind of home and number of bedrooms, from market lettings only (not social-housing programmes, relatives' deals or rooms on joint contracts), and answer from that copy.",
  handle: async (p, ctx) =>
    twRents({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
  harvest: twRentsHarvest,
});
