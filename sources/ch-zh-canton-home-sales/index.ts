// Manifest: Switzerland (canton Zürich) registered sale prices of houses and condominiums by market region and municipality. Logic lives in ./source.ts.
// Sits BEFORE ch-zurich-home-sales (folder order: "zh" < "zurich"): this source says yes to canton places, to houses anywhere in CH (not Basel-Landschaft),
// and no to the city of Zürich asked for flats, which ch-zurich-home-sales answers at district level.
import { defineSource, str } from "../../lib/plugin";
import { servesBl } from "../ch-zz-bl-home-sales/source";
import { INFO, servesZh, zhHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CH"],
  countryHelp: "CH = Switzerland: canton Zürich by municipality or market region (houses and flats; median with 10th-90th percentile; yearly), the city of Zürich by district, and Basel-Landschaft by district",
  placeName: "Canton Zürich (Switzerland)",
  status: "live",
  serves: (p) => servesZh({ country: p.country, town: p.town, property_type: p.property_type }, servesBl),
  paramNotes: {
    town: "CH canton Zürich: a municipality (Winterthur, Uster, Dübendorf, Horgen, Küsnacht ...), a market region (Seegemeinden, Agglomerationsgemeinden, Landgemeinden), or Kanton Zürich for the whole canton. Houses in the city of Zürich: Zürich.",
    postcode: "CH: not used; give the municipality in town.",
    property_type: "CH canton Zürich: house (single-family house) or flat (condominium). Default flat.",
    months: "CH: not used; the figure is for the latest year published.",
  },
  paramValues: { property_type: ["house", "flat"] },
  examples: [
    { params: { country: "CH", town: "Winterthur", property_type: "flat" } },
    { params: { country: "CH", town: "Seegemeinden", property_type: "house" }, smoke: false },
    { params: { country: "CH", town: "Kanton Zürich", property_type: "flat" }, smoke: false },
  ],
  method:
    "Switzerland (canton Zürich): the median, 10th and 90th percentile of registered sale prices of single-family houses and condominiums by market region and year, and the pooled median of each municipality, from the Statistisches Amt Kanton Zürich. Official aggregates of registered sales.",
  handle: (p, ctx) => zhHomeSales({ town: str(p.town), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
  noHistory: "Canton Zürich: the Statistisches Amt publishes one figure per region or municipality and year, so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales for the newest figure, which carries the year before.",
});
