// Manifest: Hong Kong MTR posted fares (MTR Corporation open data on DATA.GOV.HK). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, hkFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["HK"],
  countryHelp: "HK = Hong Kong (MTR train fares between two stations from the MTR Corporation's open data, HKD, a posted tariff; Airport Express, Light Rail and MTR Bus not included)",
  placeName: "Hong Kong (MTR)",
  status: "live",
  paramNotes: {
    fare_type: "Hong Kong (MTR): adult (default), senior = the elderly concession fare, or disability = the concession fare for persons with a disability. student and workfare are not available.",
    distance_km: "Hong Kong (MTR): not used; the fare depends on the two stations, so give from_station and to_station.",
    travel_time: "Hong Kong (MTR): not used; MTR fares do not change with the time of day in this table.",
  },
  extraParams: {
    from_station: z.string().optional().describe("HK only (required): the MTR station you start at, by English name such as 'Central' or 'Tsim Sha Tsui'."),
    to_station: z.string().optional().describe("HK only (required): the MTR station you end at, by English name such as 'Mong Kok' or 'Tung Chung'."),
    ticket: z.string().optional().describe("HK only: octopus (default, the Octopus card fare) or single (single-journey ticket; adult and senior only)."),
  },
  examples: [
    { params: { country: "HK", from_station: "Central", to_station: "Tsim Sha Tsui" } },
    { params: { country: "HK", from_station: "Admiralty", to_station: "Tung Chung", fare_type: "senior", ticket: "single" }, smoke: false },
  ],
  method:
    "Hong Kong MTR fares: the MTR Corporation's posted fare for one journey between two stations by fare group and ticket type, in Hong Kong dollars, from its open-data fare table. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    hkFares({ from_station: str(p.from_station), to_station: str(p.to_station), fare_type: str(p.fare_type), ticket: str(p.ticket), baseUrl: ctx.baseUrl }),
});
