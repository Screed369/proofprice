// Manifest: Canada government surplus sale prices (GCSurplus items sold). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, GROUPS, caAuctionPrices, caHarvest, caHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "surplus-auctions",
  countries: ["CA"],
  countryHelp: "CA = Canada (Government of Canada surplus sold through GCSurplus)",
  placeName: "Canada (federal surplus)",
  status: "beta",
  paramNotes: {
    what: `CA: one of ${GROUPS.join(", ")}, or a word such as 'truck', 'laptop', 'forklift', 'desk'.`,
    state: "CA: province or territory, name or two-letter code ('ON', 'Quebec'). Omit for all of Canada.",
    months: "CA: rounded to the nearest of 6, 12 or 24.",
  },
  examples: [
    { params: { country: "CA", what: "vehicles" } },
    { params: { country: "CA", what: "heavy equipment", state: "ON", months: "24" }, smoke: false },
  ],
  method:
    "Canada: median sold amount on Government of Canada surplus lots (GCSurplus), by group and province, collected daily from the half-yearly open files into our price library; used goods, not retail prices.",
  handle: (p, ctx) => caAuctionPrices({ what: String(p.what), state: str(p.state), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: caHarvest,
  historyKey: (p) => caHistoryKey({ what: str(p.what), state: str(p.state), months: num(p.months) }),
});
