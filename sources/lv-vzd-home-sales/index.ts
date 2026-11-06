// Manifest: Latvia home sales (VZD apartment sale statistics from the Real Estate Market Database). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, lvHarvest, lvHistoryKey, lvHomeSales } from "./source";

export default defineSource({
  info: INFO,
  category: "home-sales",
  countries: ["LV"],
  countryHelp: "LV = Latvia (VZD median apartment price per town and parish, calendar year; with no town the Eurostat house price index answers)",
  placeName: "Latvia",
  status: "live",
  paramNotes: {
    town: "LV: a town (Riga, Jurmala, Liepaja, Daugavpils, Valmiera ...), a rural parish such as 'Bebru pagasts', or a municipality such as 'Valmieras novads' (answers for its towns). Without a town the Eurostat price index answers instead.",
    postcode: "LV: not supported (VZD publishes towns and parishes).",
    property_type: "LV: apartments only ('flat', the default).",
    months: "LV: ignored; VZD publishes calendar years (the latest full year is returned).",
  },
  extraParams: {
    rooms: z.number().int().min(1).max(4).optional().describe("LV only: number of rooms of the apartment, 1 to 4. Without it the size with the most deals is returned and the other sizes are listed."),
  },
  examples: [
    { params: { country: "LV", town: "Riga" } },
    { params: { country: "LV", town: "Valmiera", rooms: "2" }, smoke: false },
  ],
  // Without a town the Eurostat index (eu-home-price-index) keeps answering Latvia; with a town VZD answers.
  serves: (p) => !!str(p.town),
  method:
    "Latvia: the median price per apartment in EUR (not per m2) of the deals VZD, the State Land Service, registered in its Real Estate Market Database, per town, parish or Riga, by room count, for the latest full calendar year, with VZD's deal count.",
  // Stale-if-error copy: the collector stores VZD's newest full-year median per place once a day (rows dated 31 December of that year).
  // Declared change for the platform gate: harvest + historyKey + referenceDates + staleMaxDays + noHistory added by the Depth Builder.
  harvest: () => lvHarvest(),
  historyKey: (p) => lvHistoryKey({ town: str(p.town), property_type: str(p.property_type), rooms: num(p.rooms) }),
  referenceDates: true,
  staleMaxDays: 35,
  noHistory: "Latvia: VZD publishes one median per calendar year and ProofPrice keeps no separate history of it yet. Ask pricepaid_home_sales (/api/v1/home-sales) for the newest year, which carries the previous year.",
  handle: (p, ctx) => lvHomeSales({ town: str(p.town), property_type: str(p.property_type), rooms: num(p.rooms), baseUrl: ctx.baseUrl }),
});
