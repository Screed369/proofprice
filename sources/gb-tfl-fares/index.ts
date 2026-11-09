// Manifest: London Underground posted fares (Transport for London Unified API). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, tflFares } from "./source";

export default defineSource({
  info: INFO,
  category: "transport-fares",
  countries: ["GB"],
  countryHelp: "GB = London Underground only (Transport for London posted adult fares between 20 central and main stations, GBP; buses, DLR, Elizabeth line, National Rail and the rest of Britain are not included)",
  placeName: "London (Underground)",
  status: "live",
  paramNotes: {
    fare_type: "London (Underground): adult only (default); child, student and concession fares are not available.",
    distance_km: "London (Underground): not used; the fare depends on the two stations, so give tfl_from and tfl_to.",
    travel_time: "London (Underground): not used; use tfl_time (peak or off-peak) instead.",
  },
  extraParams: {
    tfl_from: z.string().optional().describe("GB only (required): the London Underground station you start at, by name such as \"King's Cross\", \"Victoria\", \"Oxford Circus\" or \"Heathrow Terminal 5\" (20 central and main stations)."),
    tfl_to: z.string().optional().describe("GB only (required): the London Underground station you end at, by name such as \"Waterloo\" or \"Bank\"."),
    tfl_ticket: z.string().optional().describe("GB only: payg (Oyster or contactless pay as you go, default) or cash (single paper ticket)."),
    tfl_time: z.string().optional().describe("GB only: peak (default, Mon-Fri 06:30-09:30 and 16:00-19:00) or off-peak. Ignored for cash and for journeys with one all-day fare."),
  },
  examples: [
    { params: { country: "GB", tfl_from: "King's Cross", tfl_to: "Victoria" } },
    { params: { country: "GB", tfl_from: "King's Cross", tfl_to: "Heathrow Terminal 5", tfl_ticket: "cash" }, smoke: false },
  ],
  method:
    "London Underground fares: Transport for London's posted adult fare for one journey between two stations by ticket type and time band, in pounds, from the TfL Unified API fare finder. A posted fare table, not amounts paid.",
  handle: (p, ctx) =>
    tflFares({ from_station: str(p.tfl_from), to_station: str(p.tfl_to), fare_type: str(p.fare_type), ticket: str(p.tfl_ticket), time_of_day: str(p.tfl_time), baseUrl: ctx.baseUrl }),
});
