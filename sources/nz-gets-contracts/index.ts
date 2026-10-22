// Manifest: New Zealand government contract prices (GETS award notices, MBIE open data). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, nzContracts, nzHarvest, nzHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "contracts",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (GETS contract award notices)",
  placeName: "New Zealand (GETS)",
  status: "live",
  paramNotes: {
    what: "NZ: a common purchase in plain words ('laptops', 'cleaning', 'consultancy', 'road resurfacing') or 'all'; read from the price library, not searched live.",
    cpv: "NZ: not used (New Zealand notices carry no CPV codes).",
    buyer_area: "NZ: part of the posting agency's name ('Auckland Council', 'Waka Kotahi', 'Health'); needs at least 5 awards.",
    months: "NZ: not used; the newest 24 months of awards are always shown.",
  },
  examples: [
    { params: { country: "NZ", what: "all" } },
    { params: { country: "NZ", what: "consultancy" }, smoke: false },
  ],
  method:
    "New Zealand GETS contract award notices (MBIE open data, quarterly file) read each day into our price library: median and 10th–90th percentile of the awarded amount in NZD over the newest 24 months, for all purchases, a common purchase found by words in the notice title, or one posting agency. Totals per contract, not unit prices; suppliers are never named.",
  handle: (p, ctx) =>
    nzContracts({ what: String(p.what), cpv: str(p.cpv), buyer_area: str(p.buyer_area), months: num(p.months), baseUrl: ctx.baseUrl }),
  harvest: nzHarvest,
  historyKey: (p) => nzHistoryKey(p),
});
