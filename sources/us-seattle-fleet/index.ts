import { z } from "zod";
import { defineSource, num } from "../../lib/plugin";
import { INFO, seattleFleetPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["US"],
  countryHelp: "US = United States (federal surplus; add city=Seattle for City of Seattle sold fleet vehicles)",
  placeName: "Seattle (City fleet sales)",
  status: "beta",
  paramNotes: { what: "US with city=Seattle: words from the item, such as 'van', 'pickup truck', 'scooter', 'patrol', 'ford'." },
  extraParams: {
    city: z.string().optional().describe("US only: 'Seattle' answers from City of Seattle sold fleet vehicles and equipment (actual auction sale prices). Leave out for US federal (GSA) surplus."),
  },
  examples: [{ params: { country: "US", what: "van", city: "Seattle" } }],
  method: "Seattle: median sale price of City of Seattle surplus fleet items sold at auction, used equipment, not retail prices.",
  // Shares surplus-auctions/US with the federal GSA source, which answers everything that does not name Seattle.
  serves: (p) => /seattle/i.test([p.city, p.town, p.place, p.area].map((v) => String(v ?? "")).join(" ")),
  handle: (p, ctx) => seattleFleetPrices({ what: String(p.what), months: num(p.months) ?? 24, baseUrl: ctx.baseUrl }),
});
