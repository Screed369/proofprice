// Manifest: farm and wholesale food prices for EU member states (European Commission Agri-food data portal API). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { productHelp, resolveProduct } from "./products";
import { COUNTRIES, euFarmPrices, INFO } from "./source";

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
  serves: (p) => !(String(p.country ?? "").toUpperCase() === "FI" && LUKE_FI_PRODUCTS.includes(productKey(p.product))),
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
});
