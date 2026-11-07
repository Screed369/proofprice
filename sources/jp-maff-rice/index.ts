// Manifest: Japan rice negotiated trade prices (MAFF, monthly, by prefecture and variety), in the farm-gate-prices tool. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, exampleVarieties, jpRiceHarvest, jpRiceMethod, jpRicePrices, riceHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["JP"],
  countryHelp:
    "JP = Japan (MAFF: monthly negotiated trade prices of rice between collecting organisations and wholesalers, by prefecture and variety, official statistic, not a live price)",
  placeName: "Japan",
  status: "live",
  paramNotes: {
    product: `Japan: 'rice' for the all-brand average, or a variety such as ${exampleVarieties()} (or its Japanese name, e.g. コシヒカリ). Only rice is covered. Prices are yen per 60 kg of brown rice, tax included.`,
    region: "Japan: optional prefecture (Niigata, Akita, Hokkaido, Kumamoto ... or 新潟). Without it the answer is the national figure. Prefectures with no price yet for the month are not shown.",
  },
  examples: [
    { params: { country: "JP", product: "rice" } },
    { params: { country: "JP", product: "koshihikari", region: "Niigata" }, smoke: false },
    { params: { country: "JP", product: "rice", region: "Akita" }, smoke: false },
  ],
  method: jpRiceMethod,
  handle: (p, ctx) => jpRicePrices({ product: String(p.product ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month so a MAFF outage is answered from it (stale-if-error). One published average per row (n is NO_COUNT),
  // dated by the reference month.
  harvest: () => jpRiceHarvest(),
  historyKey: (p) => riceHistoryKey({ product: str(p.product), region: str(p.region) }),
  referenceDates: true,
  nominalCounts: true,
});
