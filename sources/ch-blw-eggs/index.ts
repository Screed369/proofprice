// Manifest: Switzerland egg producer prices (BLW / FOAG "Market figures eggs", monthly weighted averages, via LINDAS). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, EGG_KEYS, chEggPrices, chEggHarvest, chEggHistoryKey, eggProductOf } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (Federal Office for Agriculture: monthly weighted average ex-farm prices of Swiss shell eggs, official statistic, not a shop price)",
  placeName: "Switzerland",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "CH" && eggProductOf(p.product) !== null,
  paramNotes: {
    product: `CH: ${EGG_KEYS.join(", ")} (BLW's monthly weighted average price at the production stage, Swiss francs per egg, including VAT; the answer also gives the price per dozen). Only eggs are covered for Switzerland.`,
    region: "CH: leave out; BLW publishes one national figure.",
  },
  examples: [
    { params: { country: "CH", product: "eggs" } },
    { params: { country: "CH", product: "organic eggs" }, smoke: false },
    { params: { country: "CH", product: "free range eggs" }, smoke: false },
  ],
  method:
    "Switzerland (eggs): the Federal Office for Agriculture's monthly weighted average realised ex-farm price of Swiss shell eggs (centimes per egg, including VAT). " +
    "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average at the production stage, not a shop price or a sale, and no range is calculated.",
  handle: (p, ctx) => chEggPrices({ product: str(p.product), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month so a LINDAS outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => chEggHarvest(),
  historyKey: (p) => chEggHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
