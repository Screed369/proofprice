// Manifest: World Bank International Comparison Program 2021, price level indices for economies outside the OECD source. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { COUNTRIES, INFO, SPEND_HELP, icpPriceLevel } from "./source";

export default defineSource({
  info: INFO,
  category: "price-levels",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". World Bank ICP 2021 survey: one price level index per country and spending group, whole country, benchmark year 2021.",
  placeName: "About 130 economies outside the OECD (World Bank ICP 2021)",
  status: "live",
  // measure=inflation (consumer price index over time) goes to eu-eurostat-hicp (Gap G20261030-PLAT-3, Simon 29 Oct)
  serves: (p) => String(p.measure ?? "").toLowerCase() !== "inflation",
  paramNotes: {
    spend: `World Bank ICP: ${SPEND_HELP}. The index is for the whole country, not a city.`,
    compare_to: "World Bank ICP countries: leave out. The index is measured against the world average (World = 100); the gap to the United States is always included.",
  },
  examples: [
    { params: { country: "IN", spend: "food" } },
    { params: { country: "SG", spend: "housing" }, smoke: false },
    { params: { country: "AE" }, smoke: false },
  ],
  method:
    "Price levels (World Bank ICP 2021): the price level index of the World Bank's International Comparison Program (world average = 100) for household consumption and about 25 spending groups, one figure per economy for the 2021 benchmark year. " +
    "We pass on the published index, the PPP rate and spending per head at PPP, and calculate the gap to the United States; it is an index from an international price survey, not a receipt or a range.",
  handle: (p, ctx) => {
    if (String(p.measure ?? "").toLowerCase() === "inflation") throw new InputError("measure=inflation is available for EU, Norway and Iceland only (see the notes); leave measure out to get this country's price level.");
    return icpPriceLevel({ country: String(p.country), spend: str(p.spend), compare_to: str(p.compare_to), baseUrl: ctx.baseUrl });
  },
});
