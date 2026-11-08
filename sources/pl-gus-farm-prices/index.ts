// Manifest: Poland farm-gate procurement prices of cereals, potatoes, cattle, pigs, poultry and cows' milk (Statistics Poland, GUS, monthly). Logic lives in ./source.ts.
// Shares country PL with eu-farm-prices (Agri-food data portal): both declare serves(). PL questions for the products below come here;
// every other Polish product (fruit, vegetables, dairy products, eggs, lamb ...) stays with eu-farm-prices.
// The folder name sorts BEFORE eu-farm-prices on purpose (the registry picks the first source whose serves() says yes, and eu-farm-prices says yes to all of PL).
import { defineSource, str } from "../../lib/plugin";
import { INFO, plFarmPrices, plHarvest, plHistoryKey, plProductOf, PL_KEYS } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-prices",
  countries: ["PL"],
  countryHelp:
    "PL = Poland (Statistics Poland, GUS: monthly procurement prices paid to farmers for cereals, potatoes, cattle, pigs, poultry and cows' milk; other Polish products come from the EU portal)",
  placeName: "Poland",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "PL" && plProductOf(p.product) !== null,
  paramNotes: {
    product: `PL: ${PL_KEYS.join(", ")} (GUS's own monthly procurement prices in zloty excluding VAT: cereals and potatoes per dt = 100 kg, animals per kg live weight, milk per hl). Other products (fruit, vegetables, eggs, dairy products ...) are answered from the European Commission portal.`,
  },
  examples: [
    { params: { country: "PL", product: "wheat" } },
    { params: { country: "PL", product: "pigs" }, smoke: false },
    { params: { country: "PL", product: "milk" }, smoke: false },
  ],
  method:
    "Poland (farm-gate prices): Statistics Poland's monthly national average procurement price paid to Polish farmers for cereals, potatoes, cattle, pigs, poultry and cows' milk, excluding VAT. " +
    "We pass on the published average and its month, with the changes on the previous month and a year earlier as GUS states them in its indices; it is a monthly average, not a sale or a live price, and no range is calculated.",
  handle: (p, ctx) => plFarmPrices({ product: str(p.product), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so a GUS outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => plHarvest(),
  historyKey: (p) => plHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
