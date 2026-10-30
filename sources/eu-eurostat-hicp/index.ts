// Manifest: consumer price inflation (HICP) for the EU, Norway and Iceland, served as measure=inflation of the price-levels tool (Eurostat). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, SPEND_HELP, euHicp } from "./source";

export default defineSource({
  info: INFO,
  category: "price-levels",
  countries: Object.keys(COUNTRIES),
  countryHelp: "EU member states plus NO and IS, as ISO codes (GR for Greece): " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", "),
  placeName: "the EU, Norway and Iceland (inflation)",
  status: "live",
  // Shares every country with oecd-price-levels / wb-icp-price-levels: this source answers only measure=inflation, they answer the rest (Simon 29 Oct, Gap G20261030-PLAT-3).
  serves: (p) => String(p.measure ?? "").toLowerCase() === "inflation",
  paramNotes: {
    measure: "EU/NO/IS: measure=inflation gives Eurostat's monthly consumer price index (2025 = 100) with the yearly and monthly change; only for these countries.",
    spend: `EU/NO/IS (inflation): ${SPEND_HELP}.`,
  },
  examples: [
    { params: { country: "IE", measure: "inflation", spend: "food" } },
    { params: { country: "DE", measure: "inflation" }, smoke: false },
  ],
  method:
    "Inflation (EU, Norway, Iceland): the harmonised index of consumer prices (2025 = 100) that Eurostat publishes every month for each country and spending division, with the change on the previous month and on a year earlier. We pass on the published index and rates and their month; it is an index of price change, not a price paid.",
  handle: (p, ctx) => euHicp({ country: String(p.country), spend: str(p.spend), baseUrl: ctx.baseUrl }),
});
