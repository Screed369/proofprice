// Manifest: Singapore trunk bus posted fares (Public Transport Council fare table on data.gov.sg). Logic lives in ./source.ts.
// Shares category "transport-fares" and country SG with sg-lta-fares (MRT/LRT): service=bus selects this source (serves()).
import { z } from "zod";
import { defineSource, str, num } from "../../lib/plugin";
import { INFO, sgBusFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["SG"],
  countryHelp: "SG = Singapore (trunk bus card and cash fares per ride from the Public Transport Council fare table, SGD, a posted tariff; add service=bus)",
  placeName: "Singapore buses",
  status: "live",
  paramNotes: {
    fare_type: "Singapore bus: adult (default), senior, student, workfare or disability.",
    distance_km: "Singapore bus: ride distance in km (default 5); the fare is read from the published band.",
    travel_time: "Singapore bus: not used, trunk bus fares have no early-morning discount.",
  },
  extraParams: {
    service: z.string().optional().describe("SG only: bus = trunk bus fares; leave out for MRT and LRT fares."),
    payment: z.string().optional().describe("SG bus only: card (default) or cash."),
  },
  serves: (p) => String(p.service ?? "").toLowerCase() === "bus",
  examples: [
    { params: { country: "SG", service: "bus", distance_km: "8.5" } },
    { params: { country: "SG", service: "bus", fare_type: "student", payment: "cash", distance_km: "12" }, smoke: false },
  ],
  method:
    "Singapore trunk bus fares: the Public Transport Council's posted fare per ride for the chosen fare group, payment method and distance band, converted to Singapore dollars. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    sgBusFares({ fare_type: str(p.fare_type), distance_km: num(p.distance_km), travel_time: str(p.travel_time), payment: str(p.payment), baseUrl: ctx.baseUrl }),
});
