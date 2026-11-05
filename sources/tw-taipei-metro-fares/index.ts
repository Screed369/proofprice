// Manifest: Taipei Metro posted fares (Taipei Rapid Transit Corporation open data on data.taipei / data.gov.tw). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, twFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Taipei Metro fares between two stations from the operator's open data, TWD, a posted tariff; other lines and operators not included)",
  placeName: "Taiwan (Taipei Metro)",
  status: "live",
  paramNotes: {
    fare_type: "Taiwan (Taipei Metro): adult (default, the full fare), or senior / disability (both give the one concession fare for senior, Love and companion card holders and children in Taipei and New Taipei). student and workfare are not available.",
    distance_km: "Taiwan (Taipei Metro): not used; the fare depends on the two stations, so give origin_station and destination_station.",
    travel_time: "Taiwan (Taipei Metro): not used; this fare table does not change with the time of day.",
  },
  extraParams: {
    origin_station: z.string().optional().describe("TW only (required): the Taipei Metro station you start at, by English name such as 'Taipei Main Station' or 'Tamsui', or Chinese name such as 台北車站."),
    destination_station: z.string().optional().describe("TW only (required): the Taipei Metro station you end at, by English name such as 'Taipei 101' or 'Songshan Airport', or Chinese name such as 西門."),
  },
  examples: [
    { params: { country: "TW", origin_station: "Taipei Main Station", destination_station: "Taipei 101" } },
    { params: { country: "TW", origin_station: "台北車站", destination_station: "淡水", fare_type: "senior" }, smoke: false },
  ],
  method:
    "Taipei Metro fares: the operator's posted fare for one journey between two stations, full or concession, in New Taiwan dollars, from its open-data fare table. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    twFares({ from_station: str(p.origin_station), to_station: str(p.destination_station), fare_type: str(p.fare_type), baseUrl: ctx.baseUrl }),
});
