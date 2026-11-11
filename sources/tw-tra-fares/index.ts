// Manifest: Taiwan Railway (TRA) posted fares (Taiwan Railway Corporation open data, data.gov.tw 6998). Logic lives in ./source.ts.
// Shares category "transport-fares" and country TW with tw-taipei-metro-fares: tw_operator=tra selects this source (serves()).
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, traFares, traHarvest, traHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (Taipei Metro fares by default; add tw_operator=tra for Taiwan Railway fares between 22 main-city stations; TWD, posted tariffs)",
  placeName: "Taiwan Railway",
  status: "live",
  paramNotes: {},
  extraParams: {
    tw_operator: z.string().optional().describe("TW only: tra = Taiwan Railway (then origin_station and destination_station are stations such as Taipei, Taichung, Tainan, Kaohsiung, Hualien); leave out for Taipei Metro."),
    passenger: z.string().optional().describe("TW Taiwan Railway only: adult (default) or child."),
  },
  serves: (p) => /^(tra|railway|rail|train|taiwan railway)$/i.test(String(p.tw_operator ?? "").trim()),
  examples: [
    { params: { country: "TW", tw_operator: "tra", origin_station: "Taipei", destination_station: "Kaohsiung" } },
    { params: { country: "TW", tw_operator: "tra", origin_station: "臺中", destination_station: "花蓮", passenger: "child" }, smoke: false },
  ],
  method:
    "Taiwan Railway fares: the operator's posted fare for one journey between two main stations on the normal route, cheapest train class with the dearest class as the maximum, in New Taiwan dollars, from its open-data fare table collected daily. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    traFares({ from_station: str(p.origin_station), to_station: str(p.destination_station), passenger: str(p.passenger), fare_type: str(p.fare_type), baseUrl: ctx.baseUrl }),
  harvest: traHarvest,
  historyKey: (p) => traHistoryKey({ from_station: str(p.origin_station), to_station: str(p.destination_station), passenger: str(p.passenger) }),
  nominalCounts: true,
});
