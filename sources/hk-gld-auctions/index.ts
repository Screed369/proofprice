// Manifest: Hong Kong government auction transaction prices (Government Logistics Department). Logic lives in ./source.ts.
import { defineSource, num } from "../../lib/plugin";
import { INFO, GROUPS, hkAuctionPrices, hkHarvest, hkHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (Government Logistics Department auctions of surplus and confiscated goods)",
  placeName: "Hong Kong (government auctions)",
  status: "beta",
  paramNotes: {
    what: `HK: one of ${GROUPS.join(", ")}, or a word such as 'car', 'van', 'motorcycle', 'container'.`,
    state: "HK: not used (whole territory).",
    months: "HK: rounded to 12 or 24.",
  },
  examples: [
    { params: { country: "HK", what: "private-cars" } },
    { params: { country: "HK", what: "container", months: "24" }, smoke: false },
  ],
  method:
    "Hong Kong: median transaction price on single-item vehicle and container lots sold at Government Logistics Department auctions, collected daily from the open files into our price library; used goods, not retail prices.",
  handle: (p, ctx) => hkAuctionPrices({ what: String(p.what), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: hkHarvest,
  historyKey: (p) => hkHistoryKey({ what: p.what ? String(p.what) : undefined, months: num(p.months) }),
});
