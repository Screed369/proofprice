// Manifest: Singapore hotel room rates (SingStat / STB Hotel Statistics, Annual). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, sgHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["SG"],
  countryHelp: "SG = Singapore (official average room rate of gazetted hotels in S$ per night, national, yearly)",
  placeName: "Singapore",
  status: "live",
  paramNotes: {
    area: "SG: leave out. Only a national figure is published; a district name is refused rather than answered with the national average.",
    stars: "SG: not available. All gazetted hotels are published together.",
  },
  examples: [{ params: { country: "SG" } }],
  method:
    "Singapore hotels: the average room rate in S$ per room night that the Singapore Department of Statistics and Singapore Tourism Board publish each year for gazetted hotels as a whole, with the number of hotels behind it. It is an official national average, not a range of bookings and not a quote for particular dates.",
  handle: (p, ctx) => sgHotels({ area: str(p.area), stars: num(p.stars), baseUrl: ctx.baseUrl }),
});
