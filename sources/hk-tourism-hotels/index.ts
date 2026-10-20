// Manifest: Hong Kong hotel room rates (CSTB average achieved room rate). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, hkHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (CSTB average achieved room rate per night in HK$, citywide, monthly official statistic)",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    area: "HK: leave out. The Bureau publishes one citywide figure; a district name is refused rather than answered with the city average.",
    stars: "HK: not available. The Bureau publishes all hotels together.",
  },
  examples: [{ params: { country: "HK" } }],
  method:
    "Hong Kong hotels: the average achieved hotel room rate in HK$ per room per night that the Culture, Sports and Tourism Bureau publishes each month for Hong Kong as a whole, with the change on a year earlier. It is an official citywide average, not a range of bookings and not a quote for particular dates.",
  handle: (p, ctx) => hkHotels({ area: str(p.area), stars: num(p.stars), baseUrl: ctx.baseUrl }),
});
