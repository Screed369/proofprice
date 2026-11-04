// Manifest: Switzerland (city of Zürich) condominium sale prices, Statistik Stadt Zürich. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, zurichHarvest, zurichHistoryKey, zurichHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CH"],
  countryHelp: "CH = Switzerland, city of Zürich only (Statistik Stadt Zürich: median price of condominiums sold, by district and quarter of the city; yearly)",
  placeName: "Zürich (Switzerland)",
  status: "live",
  paramNotes: {
    town: "CH: Zürich for the whole city, a district ('Kreis 7', 'Kreis 11') or a statistical quarter (Altstetten, Oerlikon, Seefeld, Enge). Other Swiss towns are not covered.",
    postcode: "CH: not used; give a district or quarter of Zürich in town.",
    property_type: "CH: flat (freehold condominium) only; houses are not in this table.",
    months: "CH: not used; the figure is for the latest year published.",
  },
  paramValues: { property_type: ["flat"] },
  examples: [
    { params: { country: "CH", town: "Zürich" } },
    { params: { country: "CH", town: "Kreis 7" }, smoke: false },
    { params: { country: "CH", town: "Altstetten" }, smoke: false },
  ],
  method:
    "Switzerland (Zürich): the median price per flat that Statistik Stadt Zürich publishes each year for freehold condominiums sold between private parties, by city district and statistical quarter, with the number of sales. An official median of registered sales, not a range.",
  handle: (p, ctx) => zurichHomeSales({ town: str(p.town), property_type: str(p.property_type), baseUrl: ctx.baseUrl }),
  // Stale-if-error copy: the collector stores the newest yearly median of the city and each district (rows dated by the year's end).
  harvest: () => zurichHarvest(),
  historyKey: (p) => zurichHistoryKey({ town: str(p.town), property_type: str(p.property_type) }),
  referenceDates: true,
  staleMaxDays: 45, // yearly figure: it cannot change between releases (the table is updated once a year, in January)
  nominalCounts: true,
  noHistory: "Zürich: Statistik Stadt Zürich publishes one median per area and year, so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure, which carries the year before.",
});
