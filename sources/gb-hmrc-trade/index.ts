// Manifest: United Kingdom border prices (HMRC Overseas Trade Statistics, customs value per kilogram). Logic lives in ./source.ts.
// Answers are read live from the key-free UK Trade Info API; the daily collector keeps the newest month of curated goods in the price library
// so that a request for one of them is still answered (and says so) if HMRC does not respond.
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, ITEMS, hmrcBorderPrice, hmrcHarvest, libraryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "border-prices",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (HMRC Overseas Trade Statistics: customs value per kilogram of goods imported or exported, by customs commodity code and partner country, monthly)",
  placeName: "the United Kingdom",
  status: "live",
  paramNotes: {
    product:
      `GB: an everyday word (${ITEMS.slice(0, 12).map((i) => i.key).join(", ")} and more) or a customs commodity code of 4 to 8 digits (HS/CN, e.g. 1001 wheat, 2710 19 diesel, 0406 cheese). ` +
      "A code groups different products, so the average depends on the mix.",
    direction: "GB: imports (default) or exports, as the UK reports them (EU and non-EU trade combined).",
    partner: "GB: optional partner country, as an ISO code (DE, US, CN, FR, NL, IE ...) or HMRC's country name.",
    period: "GB: the last month to include (YYYY-MM). HMRC publishes about six weeks after the month ends; default is the newest published month.",
    months: "GB: months to include, 1 to 12 (default 1).",
  },
  examples: [
    { params: { country: "GB", product: "wheat", direction: "imports" } },
    { params: { country: "GB", product: "diesel", direction: "imports" }, smoke: false },
    { params: { country: "GB", product: "whisky", direction: "exports", months: "3" }, smoke: false },
  ],
  method:
    "United Kingdom (border prices): HM Revenue and Customs publishes every month the value declared to customs and the net weight of UK imports and exports by commodity code, partner country and port. " +
    "We read the lines for the goods, direction, partner and months asked about, add up value and weight and divide, so the figure is a value-weighted customs value per kilogram, with the 10th to 90th percentile of the individual lines weighted by kilograms. " +
    "It is the value at the border, not a shelf price.",
  nominalCounts: true,
  referenceDates: true,
  harvest: () => hmrcHarvest(),
  historyKey: (p) => {
    // The library holds the newest month, all partners: only that exact question can fall back to it.
    if (str(p.partner) || str(p.period) || (num(p.months) ?? 1) !== 1) return null;
    return libraryKey({ product: String(p.product ?? ""), direction: String(p.direction ?? "imports") });
  },
  handle: (p, ctx) =>
    hmrcBorderPrice({
      product: String(p.product),
      direction: p.direction === "exports" ? "exports" : "imports",
      partner: str(p.partner),
      period: str(p.period),
      months: num(p.months),
      baseUrl: ctx.baseUrl,
    }),
});
