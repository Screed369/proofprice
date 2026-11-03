// Manifest: NSW Opal card posted fares (Transport for NSW Opal Fares dataset, CC BY). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, opalFares, opalHarvest, opalHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["AU"],
  countryHelp: "AU = Australia (New South Wales only: Opal card fares for Sydney, Newcastle, Central Coast, Illawarra and the Blue Mountains from Transport for NSW, AUD, a posted tariff)",
  placeName: "Sydney and NSW (Opal)",
  status: "live",
  paramNotes: {
    fare_type: "Australia (NSW Opal): adult (default); student = the Child/Youth Opal fare; senior = the Senior/Pensioner concession fare (capped at AUD 2.50 a day). workfare and disability are not available.",
    distance_km: "Australia (NSW Opal): trip distance in km (default 5); the fare is read from the published band (train 0-10, 10-20, 20-35, 35-65, 65+ km; bus, light rail 0-3, 3-8, 8+ km; ferry 0-9, 9+ km).",
    travel_time: "Australia (NSW Opal): other = peak, the full fare (default); early = off-peak (30% cheaper on train, bus and light rail; ferries have no off-peak discount).",
  },
  extraParams: {
    mode: z.string().optional().describe("AU (NSW Opal) only: train (default), bus, light_rail or ferry."),
  },
  examples: [
    { params: { country: "AU", mode: "train", distance_km: "12" } },
    { params: { country: "AU", mode: "bus", fare_type: "student", distance_km: "5", travel_time: "early" }, smoke: false },
  ],
  method:
    "NSW Opal fares: Transport for NSW's posted Opal card fare for one trip by mode, distance band, peak or off-peak and card type, in Australian dollars, from the current Opal Fare Values sheet. A posted fare table, not amounts paid.",
  harvest: () => opalHarvest(),
  historyKey: (p) => opalHistoryKey({ mode: str(p.mode), fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time) }),
  referenceDates: true,
  nominalCounts: true,
  handle: (p, ctx) =>
    opalFares({ mode: str(p.mode), fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), baseUrl: ctx.baseUrl }),
});
