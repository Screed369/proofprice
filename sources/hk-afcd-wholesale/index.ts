// Manifest: Hong Kong wholesale fresh food prices (AFCD daily reference prices via DATA.GOV.HK). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, hkWholesale } from "./source";

export default defineSource({
  info: INFO,
  category: "wholesale-fresh-food",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (AFCD daily average reference wholesale prices of fresh food, posted by wholesalers, not paid prices)",
  placeName: "Hong Kong",
  status: "live",
  paramNotes: {
    product:
      "HK: live pig, live cattle, live chicken (local or mainland), eggs (mainland, USA, Germany), marine fish (golden thread, yellow croaker, mackerel, hairtail...), freshwater fish (grass carp, big head, mud carp) " +
      "and vegetables (tomato, potato, broccoli, spinach, cabbage, Chinese kale, celery...). Prices are HK$ per kg (converted from per catty) or HK$ per egg; the answer names the unit and the day.",
  },
  examples: [
    { params: { country: "HK", product: "live pig" } },
    { params: { country: "HK", product: "eggs" }, smoke: false },
    { params: { country: "HK", product: "tomato" }, smoke: false },
  ],
  method: METHOD,
  handle: (p, ctx) => hkWholesale({ product: str(p.product), baseUrl: ctx.baseUrl }),
});
