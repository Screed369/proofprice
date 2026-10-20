// Manifest: OECD / Eurostat PPP programme, price level indices by country and spending group. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, SPEND_HELP, oecdPriceLevel } from "./source";

export default defineSource({
  info: INFO,
  category: "price-levels",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". OECD/Eurostat PPP survey: one price level index per country, year and spending group, whole country.",
  placeName: "47 countries (the 38 OECD members plus Bulgaria, Cyprus, Malta, Romania and some Balkan states)",
  status: "live",
  paramNotes: {
    spend: `OECD: ${SPEND_HELP}. The index is for the whole country, not a city.`,
    compare_to: "OECD: 'OECD' (default, OECD average = 100), 'USA' (United States = 100) or 'EU' (EU-27 average = 100).",
  },
  examples: [
    { params: { country: "IE", spend: "food" } },
    { params: { country: "CH" }, smoke: false },
    { params: { country: "ES", spend: "housing", compare_to: "EU" }, smoke: false },
  ],
  method:
    "Price levels: the price level index of the OECD/Eurostat PPP programme (OECD = 100, or the USA or the EU-27), for household consumption and about 25 everyday spending groups, one figure per country and year. " +
    "We pass on the published index and the PPP rate and calculate the gap to the comparison average and the rank among surveyed countries; it is an index from a price survey, not a receipt or a range.",
  handle: (p, ctx) => oecdPriceLevel({ country: String(p.country), spend: str(p.spend), compare_to: str(p.compare_to), baseUrl: ctx.baseUrl }),
});
