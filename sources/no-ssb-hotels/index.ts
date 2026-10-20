// Manifest: Norway hotel room prices (Statistics Norway, table 14168). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, noHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["NO"],
  countryHelp: "NO = Norway (Statistics Norway hotel statistics, average price per occupied room per night, in NOK)",
  placeName: "Norway",
  status: "live",
  paramNotes: {
    area: "NO: optional. A county ('Oslo', 'Vestland', 'Rogaland', 'Troms', 'Svalbard') or a main city ('Bergen', 'Stavanger', 'Trondheim', 'Tromso') as SSB counts them; Norwegian spellings work. Leave out for the whole country.",
    stars: "NO: not used (SSB publishes no star split).",
  },
  examples: [
    { params: { country: "NO" } },
    { params: { country: "NO", area: "Oslo" }, smoke: false },
    { params: { country: "NO", area: "Vestland" }, smoke: false },
  ],
  method:
    "Norway hotels: the average price per occupied hotel room per night that hotels report to Statistics Norway, by county and month. We pass on the latest published month with the change on a year earlier; it is an official average, not a range of bookings.",
  handle: (p, ctx) => noHotels({ area: str(p.area), baseUrl: ctx.baseUrl }),
});
