// Manifest: World Bank Food Prices for Nutrition, the modelled cost of the cheapest healthy diet per person per day. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, GROUP_HELP, INFO, wbDietCost } from "./source";

export default defineSource({
  info: INFO,
  category: "diet-costs",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". World Bank estimate for the whole country, one figure per year (2017 onwards).",
  placeName: "about 90 countries worldwide (World Bank estimates)",
  status: "live",
  paramNotes: {
    food_group: `World Bank: ${GROUP_HELP}. The figure is in the country's own currency per person per day, with international (PPP) dollars in the answer. Blank for some countries and years.`,
    year: "World Bank: 2017 to the newest year held (2025 at the last check). Leave out for the newest year.",
  },
  examples: [
    { params: { country: "IE" } },
    { params: { country: "US", food_group: "fruit" }, smoke: false },
    { params: { country: "SG", year: "2023" }, smoke: false },
  ],
  method:
    "Cost of a healthy diet: the World Bank's Food Prices for Nutrition estimate of the cheapest set of foods that meets a healthy-diet standard, priced from International Comparison Program food prices. " +
    "We pass on the published national figure for a year in local currency and PPP dollars, with the change on the year before that we calculate from two published figures; it is a modelled estimate, not a receipt or a range.",
  handle: (p, ctx) =>
    wbDietCost({ country: String(p.country), food_group: str(p.food_group), year: p.year === undefined || p.year === "" ? undefined : Number(p.year), baseUrl: ctx.baseUrl }),
});
