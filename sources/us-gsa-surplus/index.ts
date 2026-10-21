import { defineSource, num, str } from "../../lib/plugin";
import { INFO, auctionPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["US"],
  countryHelp: "US = United States",
  placeName: "the United States (federal surplus)",
  status: "beta",
  paramNotes: { state: "US: two-letter state or territory code ('TX'). The auctions are US federal surplus and seized goods." },
  examples: [
    { params: { country: "US", what: "vehicles" } },
    { params: { country: "US", what: "office furniture", state: "TX" }, smoke: false },
  ],
  method: "United States: median final bid on sold GSA surplus auction lots, used goods, not retail prices.",
  handle: (p, ctx) => auctionPrices({ what: String(p.what), state: str(p.state), months: num(p.months) ?? 12, baseUrl: ctx.baseUrl }),
});
