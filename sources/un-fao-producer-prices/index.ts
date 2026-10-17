// Manifest: annual farm-gate producer prices from FAOSTAT (UN FAO) for 9 non-EU countries. Logic lives in ./source.ts.
// The daily collector (harvest) copies the newest FAOSTAT figures into the price library; requests are answered from the library.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, faoHarvest, faoProducerPrices } from "./source";

export default defineSource({
  info: INFO,
  category: "producer-prices",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "Countries outside the EU, as ISO codes: " + Object.entries(COUNTRIES).map(([c, v]) => `${c} = ${v.name}`).join(", ") +
    ". FAOSTAT annual producer (farm-gate) prices: one figure per country, product and year, usually one to two years old.",
  placeName: "9 countries from FAOSTAT (US, CA, BR, MX, AU, NZ, SG, JP, KR)",
  status: "live",
  paramNotes: {
    product:
      "US, CA, BR, MX, AU, NZ, SG, JP, KR (FAOSTAT; KR has few products): the crop or animal product, by everyday name: wheat, maize (corn), rice, barley, soybeans, potatoes, tomatoes, apples, bananas, oranges, beef, pork, chicken, eggs, milk, coffee, cotton and many more. " +
      "Annual price per tonne in the country's own currency (and in US dollars where FAO gives it), also per kg. Not every country has every product: the answer lists what is available.",
  },
  examples: [
    { params: { country: "US", product: "wheat" } },
    { params: { country: "BR", product: "soybeans" }, smoke: false },
    { params: { country: "JP", product: "rice" }, smoke: false },
  ],
  method:
    "FAOSTAT producer prices: the annual farm-gate price per tonne that the UN Food and Agriculture Organization publishes for a crop or animal product in a country, from national statistics or FAO estimates. " +
    "We copy the FAO bulk file once a day and pass on the newest figure with its year and whether FAO marks it as estimated; it is an official statistic, not a list of sales, so there is no range and no sample size.",
  nominalCounts: true,
  harvest: () => faoHarvest(),
  handle: (p, ctx) => faoProducerPrices({ country: String(p.country), product: str(p.product), baseUrl: ctx.baseUrl }),
});
