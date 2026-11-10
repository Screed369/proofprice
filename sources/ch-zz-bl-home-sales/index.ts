// Manifest: Switzerland (canton Basel-Landschaft) average condominium sale prices, Kanton Basel-Landschaft open data. Logic lives in ./source.ts.
// Shares country CH with ch-zurich-home-sales (no serves() there). The folder id sorts AFTER it on purpose ("zz"): when no source says yes,
// the registry takes the first CH source, which must stay Zürich. This source answers only when serves() says yes (a BL district or main municipality).
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, blHarvest, blHistoryKey, blHomeSales, servesBl } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["CH"],
  countryHelp: "CH = Switzerland: city of Zürich, and the canton Basel-Landschaft by district (average price of condominiums, by number of rooms; yearly)",
  placeName: "Basel-Landschaft (Switzerland)",
  status: "live",
  serves: (p) => servesBl({ country: p.country, town: p.town }),
  paramNotes: {
    town: "CH: for Basel-Landschaft give a district (Arlesheim, Laufen, Liestal, Sissach, Waldenburg) or a main municipality such as Muttenz or Pratteln (its district average is shown). For the city of Zürich give Zürich.",
    property_type: "CH: flat (condominium) only; houses are not in these tables.",
    months: "CH: not used; the figure is for the latest year published.",
  },
  paramValues: { property_type: ["flat"] },
  extraParams: {
    room_count: z.string().optional().describe("CH Basel-Landschaft only: number of rooms 1, 2, 3, 4 or 5 (5 or more). Leave out for all condominiums."),
  },
  examples: [
    { params: { country: "CH", town: "Liestal" } },
    { params: { country: "CH", town: "Arlesheim", room_count: "3" }, smoke: false },
  ],
  method:
    "Switzerland (Basel-Landschaft): the average sale price of condominiums by district and number of rooms that Kanton Basel-Landschaft publishes each year. An official average, not a median; no sale counts or range are published.",
  handle: (p, ctx) => blHomeSales({ town: str(p.town), property_type: str(p.property_type), rooms: str(p.room_count), baseUrl: ctx.baseUrl }),
  harvest: () => blHarvest(),
  historyKey: (p) => blHistoryKey({ town: str(p.town), property_type: str(p.property_type), rooms: str(p.room_count) }),
  referenceDates: true,
  staleMaxDays: 45,
  nominalCounts: true,
  noHistory: "Basel-Landschaft: the canton publishes one average per district, room count and year, so daily snapshots would only repeat it; ProofPrice keeps no history of it. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest figure, which carries the year before.",
});
