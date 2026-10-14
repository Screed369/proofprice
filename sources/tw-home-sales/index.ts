// Manifest: Taiwan home sales (Ministry of the Interior, actual price registration). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, twHomeSales, twHomeSalesHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Ministry of the Interior actual price registration: every registered sale, summarised by city or county and district)",
  placeName: "Taiwan",
  status: "live",
  paramNotes: {
    town:
      "TW: a city or county in English or Chinese ('Taipei' / '台北市' / '臺北市', 'New Taipei', 'Taichung', 'Kaohsiung', 'Tainan', 'Taoyuan', 'Hsinchu City', 'Hsinchu County'), or a district with its city (\"Da'an, Taipei\", '臺北市大安區', 'Banqiao, New Taipei'). Omit for all of Taiwan. A district name used in several cities ('Zhongzheng', 'Dongqu') needs the city too.",
    postcode: "TW: not supported (the register has no postcodes); give the city, county or district as town.",
    property_type:
      "TW: apartment (high-rise, mid-rise and walk-up flats together), house (透天厝), high-rise (住宅大樓, 11+ floors with a lift), mid-rise (華廈, up to 10 floors with a lift) or walk-up (公寓, up to 5 floors, no lift). Default any = all homes.",
    months: "TW: 12 or 24 whole calendar months; up to 18 gives 12 (24 if a place has too few sales in 12), more gives 24. The window ends at the last month that is at least 30 days old.",
  },
  paramValues: { property_type: ["apartment", "house", "high-rise", "mid-rise", "walk-up"] },
  examples: [
    { params: { country: "TW", town: "Taipei" } },
    { params: { country: "TW", town: "Da'an, Taipei" }, smoke: false },
    { params: { country: "TW", town: "New Taipei", property_type: "apartment" }, smoke: false },
  ],
  pages: [
    { params: { country: "TW", town: "Taipei" }, label: "Taipei", question: "What do homes sell for in Taipei, Taiwan?" },
    { params: { country: "TW", town: "Da'an, Taipei" }, label: "Da'an, Taipei", question: "What do homes sell for in Da'an District, Taipei?" },
    { params: { country: "TW", town: "New Taipei" }, label: "New Taipei", question: "What do homes sell for in New Taipei City?" },
    { params: { country: "TW", town: "Taoyuan" }, label: "Taoyuan", question: "What do homes sell for in Taoyuan, Taiwan?" },
    { params: { country: "TW", town: "Hsinchu City" }, label: "Hsinchu City", question: "What do homes sell for in Hsinchu City, Taiwan?" },
    { params: { country: "TW", town: "Taichung" }, label: "Taichung", question: "What do homes sell for in Taichung, Taiwan?" },
    { params: { country: "TW", town: "Tainan" }, label: "Tainan", question: "What do homes sell for in Tainan, Taiwan?" },
    { params: { country: "TW", town: "Kaohsiung" }, label: "Kaohsiung", question: "What do homes sell for in Kaohsiung, Taiwan?" },
  ],
  method:
    "Taiwan: the Ministry of the Interior's actual price registration open data (every registered property sale, with its price) is read by our collector from the official releases; we keep the median and 10th–90th percentile of the total price and of the price per m² for the last 12 and 24 whole months, per city or county, district and building type, from residential market sales only (not relatives' deals, presales, government or other special cases), and answer from that copy.",
  handle: async (p, ctx) =>
    twHomeSales({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
  harvest: twHomeSalesHarvest,
});
