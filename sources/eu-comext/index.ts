// Manifest: EU border prices (Eurostat Comext customs value per kilogram) for 11 member states. Logic lives in ./source.ts.
// Answers are read live from the key-free Eurostat Comext API. Free tier only: the licence has trade-data exceptions that were not cleared for paid use.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, ITEMS, REPORTERS, comextBorderPrice } from "./source";

export default defineSource({
  info: INFO,
  category: "border-prices",
  countries: Object.keys(REPORTERS),
  countryHelp: "FR, DE, ES, IT, NL, BE, IE, PL, PT, DK, SE = EU member states (Eurostat Comext: customs value per kilogram of goods imported or exported, by customs commodity code and partner country, monthly)",
  placeName: "the EU member states listed",
  status: "live",
  paramNotes: {
    product:
      `EU: an everyday word (${ITEMS.slice(0, 12).map((i) => i.key).join(", ")} and more) or a customs commodity code of 4, 6 or 8 digits (HS/CN, e.g. 1001 wheat, 271019 diesel, 0406 cheese). ` +
      "A code groups different products, so the average depends on the mix.",
    direction: "EU: imports (default) or exports of the country asked about, trade with all other countries.",
    partner: "EU: optional partner country, as a 2-letter ISO code (DE, US, CN, BR ...) or common name.",
    period: "EU: the last month to include (YYYY-MM). Eurostat publishes about 2.5 months after the month ends; default is the newest published month.",
    months: "EU: months to include, 1 to 12 (default 1).",
  },
  examples: [
    { params: { country: "DE", product: "wheat", direction: "imports" } },
    { params: { country: "FR", product: "cheese", direction: "exports", months: "3" }, smoke: false },
  ],
  method:
    "EU member states (border prices): Eurostat's Comext database publishes every month the value declared to customs and the quantity of each country's imports and exports by commodity code and partner country. " +
    "We read the cell for the goods, direction, partner and months asked about, add up value and weight and divide, so the figure is a value-weighted customs value per kilogram. It is the value at the border, not a shelf price.",
  nominalCounts: true,
  referenceDates: true,
  handle: (p, ctx) =>
    comextBorderPrice({
      country: String(p.country),
      product: String(p.product),
      direction: p.direction === "exports" ? "exports" : "imports",
      partner: str(p.partner),
      period: str(p.period),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
});
