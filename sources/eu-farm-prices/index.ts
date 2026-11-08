// Manifest: farm and wholesale food prices for EU member states (European Commission Agri-food data portal API). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { productHelp, resolveProduct } from "./products";
import { plProductOf } from "../pl-gus-farm-prices/source";
import { COUNTRIES, euFarmHarvest, euFarmPrices, farmHistoryKey, INFO } from "./source";

/** Product keys for which Luke (fi-luke-farm-prices) answers FI. A test in that folder checks both lists agree. */
const LUKE_FI_PRODUCTS = ["pig", "beef", "young bull", "heifer", "cow", "calf", "lamb", "chicken", "eggs", "barn eggs", "free range eggs", "organic eggs", "cage eggs", "milk"];
function productKey(raw: unknown): string {
  try {
    return resolveProduct(typeof raw === "string" ? raw : String(raw ?? "")).key;
  } catch {
    return "";
  }
}

export default defineSource({
  info: INFO,
  category: "farm-prices",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "EU member states, as ISO codes (GR for Greece): " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", ") +
    ". Not covered: LU (the portal holds no Luxembourg prices) and countries outside the EU such as GB and NO. " +
    "Not every country reports every product (olive oil: ES, IT, PT, GR and HR only; dairy products about 16 countries); the answer says when a product is missing.",
  placeName: "EU member states",
  status: "live",
  // FI meat, milk and egg producer prices that Luke publishes go to fi-luke-farm-prices (declared serves() change, Gap fix
  // G20261023-PLATFORM-SERVES-FI-FARM-US-DC part 1, same commit as that source); everything else for FI stays here.
  // FR crops the EU portal does not carry (rapeseed, sunflower, peas ...) go to fr-famag-grain (FranceAgriMer, folder sorts after this one): for FR with a
  // product this source cannot resolve, serves() says no. No product, or a product we know, stays here. Unknown products for any other country stay here too (clear error).
  serves: (p) => {
    const country = String(p.country ?? "").toUpperCase();
    if (country === "FI" && LUKE_FI_PRODUCTS.includes(productKey(p.product))) return false;
    // PL producer prices GUS publishes (declared serves() change, Repairer 8 Nov, platform task from Builder C) go to pl-gus-farm-prices.
    if (country === "PL" && plProductOf(p.product) !== null) return false;
    if (country === "FR" && typeof p.product === "string" && p.product.trim() !== "" && productKey(p.product) === "") return false;
    return true;
  },
  paramNotes: {
    product:
      "EU: required. The product, by name; aliases such as 'pork', 'corn', 'tomato' are understood. Prices are weekly (raw milk monthly), per tonne for cereals and per 100 kg otherwise (piglets per head), " +
      `each answer also gives the price per kg. ${productHelp()}. ` +
      "Products with several series (wheat: milling then feed; pig: class E; beef: adult male cattle indicative price) show the usual one and list the others in extra.other_series. " +
      "Fruit and vegetables are only quoted in season.",
  },
  examples: [
    { params: { country: "IE", product: "pig" } },
    { params: { country: "FR", product: "wheat" }, smoke: false },
    { params: { country: "ES", product: "olive oil" }, smoke: false },
    { params: { country: "IE", product: "milk" }, smoke: false },
    { params: { country: "PL", product: "apples" }, smoke: false },
    { params: { country: "DE", product: "butter" }, smoke: false },
  ],
  method:
    "Farm and wholesale food prices: the weekly (raw milk: monthly) prices that EU Member States report to the European Commission for cereals, beef, pigs, lamb, poultry, eggs, milk, dairy products, olive oil and fruit and vegetables, " +
    "from the Commission's Agri-food data portal. We pass on the latest published figure with its week or month, stage of the supply chain and the change from before; it is an official price, not a list of trades.",
  handle: (p, ctx) =>
    euFarmPrices({
      country: String(p.country),
      product: str(p.product),
      baseUrl: ctx.baseUrl,
    }),
  // A daily copy of the newest weekly price (euro per kg) so a portal outage or throttle is answered from it (stale-if-error).
  harvest: () => euFarmHarvest(),
  historyKey: (p) => farmHistoryKey({ country: str(p.country), product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "History is not offered for EU farm prices yet: the daily copy holds only the newest weekly price per country and product, kept for outages.",
});
