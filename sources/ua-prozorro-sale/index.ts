// Manifest: Ukrainian public asset sale prices (Prozorro.Sale open data). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, GROUPS, REGION_LABELS, uaPublicSales, uaSaleHarvest } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["UA"],
  countryHelp: "UA = Ukraine (state, municipal and bankrupt-estate assets sold on Prozorro.Sale)",
  placeName: "Ukraine (Prozorro.Sale public asset sales)",
  status: "beta",
  paramNotes: {
    what: `UA: one of ${GROUPS.join(", ")}, or a word such as 'truck', 'building', 'land', 'grain'. 'any' covers every concluded sale.`,
    state: `UA: region (oblast) name such as ${Object.values(REGION_LABELS).slice(0, 5).join(", ")}; 'Kyiv' alone means the city, 'Kyiv oblast' the region. Omit for all of Ukraine.`,
    months: "UA: not used; each figure covers contracts signed in the newest 60 days.",
  },
  examples: [{ params: { country: "UA", what: "vehicles" } }, { params: { country: "UA", what: "any", state: "Kharkiv" }, smoke: false }],
  method:
    "Ukraine: median signed contract amount on concluded Prozorro.Sale auctions of state, municipal and bankrupt-estate assets (rentals left out), by group and region, signed in the newest 60 days, collected daily into our price library; amounts are per whole lot, not retail prices.",
  handle: (p, ctx) => uaPublicSales({ what: String(p.what), state: str(p.state), baseUrl: ctx.baseUrl }),
  harvest: () => uaSaleHarvest(),
  noHistory:
    "Ukraine: the sale figures cover the newest 60 days of signed contracts in one window; ProofPrice keeps no daily history of them. Ask pricepaid_auction_prices (/api/v1/auctions) for the current figure.",
});
