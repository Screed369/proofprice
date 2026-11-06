// Manifest: Austria producer prices of rapeseed, soybeans, potatoes, seeds, turkey, fish, hay, straw, game and grapes (STATISTIK AUSTRIA, monthly). Logic lives in ./source.ts.
// Shares country AT with eu-farm-prices (Agri-food data portal): both declare serves(). AT questions for the products below come here;
// pigs, cattle, lamb, chicken, eggs, milk, dairy and cereals stay with eu-farm-prices (weekly European Commission prices).
import { defineSource, str } from "../../lib/plugin";
import { atFarmPrices, atHarvest, atHistoryKey, atProductOf, AT_KEYS, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-prices",
  countries: ["AT"],
  countryHelp:
    "AT = Austria (STATISTIK AUSTRIA: monthly producer prices of rapeseed, soybeans, potatoes, sunflower, poppy and pumpkin seed, turkey, carp, trout, hay, straw, game and grapes; other Austrian products come from the EU portal)",
  placeName: "Austria",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "AT" && atProductOf(p.product) !== null,
  paramNotes: {
    product: `AT: ${AT_KEYS.join(", ")} (STATISTIK AUSTRIA's own monthly producer prices, net of VAT: oilseeds, potatoes, hay and straw per tonne, game and fish per kg, turkey and grapes per 100 kg). Other products (pig, cattle, milk, eggs, wheat ...) are answered from the European Commission portal.`,
  },
  examples: [
    { params: { country: "AT", product: "rapeseed" } },
    { params: { country: "AT", product: "soybeans" }, smoke: false },
    { params: { country: "AT", product: "potatoes" }, smoke: false },
  ],
  method:
    "Austria (producer prices): STATISTIK AUSTRIA's monthly national average price received by Austrian producers, net of VAT. " +
    "We pass on the published average and its month, with the change on the previous month that we calculate from two published averages and the change on a year earlier as the publisher states it; it is a monthly average, not a sale or a live price, and no range is calculated.",
  handle: (p, ctx) => atFarmPrices({ product: str(p.product), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month, so a STATISTIK AUSTRIA outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => atHarvest(),
  historyKey: (p) => atHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
