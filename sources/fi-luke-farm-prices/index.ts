// Manifest: Finland farm-gate prices of meat, milk and eggs (Luke, Natural Resources Institute Finland, monthly producer prices). Logic lives in ./source.ts.
// Shares country FI with eu-farm-prices (Agri-food data portal): both declare serves(). FI questions for the products below come here;
// piglets, dairy products, cereals, fruit and vegetables and the sub-series Luke does not publish stay with eu-farm-prices.
import { defineSource, str } from "../../lib/plugin";
import { INFO, lukeFarmPrices, lukeHarvest, lukeHistoryKey, lukeProductOf, LUKE_KEYS } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-prices",
  countries: ["FI"],
  countryHelp:
    "FI = Finland (Luke, Natural Resources Institute Finland: monthly average producer prices of beef, pigs, lamb, broilers, eggs and raw milk; other Finnish products come from the EU portal)",
  placeName: "Finland",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "FI" && lukeProductOf(p.product) !== null,
  paramNotes: {
    product: `FI: ${LUKE_KEYS.join(", ")} (Luke's own monthly producer prices, EUR per 100 kg; milk per litre). Other products are answered from the European Commission portal.`,
  },
  examples: [
    { params: { country: "FI", product: "pig" } },
    { params: { country: "FI", product: "milk" }, smoke: false },
    { params: { country: "FI", product: "eggs" }, smoke: false },
  ],
  method:
    "Finland (farm-gate prices): Luke's monthly average price paid to Finnish producers for beef, pigs, lamb, broilers, eggs and raw milk. " +
    "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average, not a sale or a live price, and no range is calculated.",
  handle: (p, ctx) => lukeFarmPrices({ product: str(p.product), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so a Luke outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => lukeHarvest(),
  historyKey: (p) => lukeHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
