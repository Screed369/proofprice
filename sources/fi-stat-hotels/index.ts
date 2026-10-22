// Manifest: Finland hotel room prices (Statistics Finland, StatFin table 11ix). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, fiHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["FI"],
  countryHelp: "FI = Finland (Statistics Finland accommodation statistics, average price per occupied hotel room per night, in EUR)",
  placeName: "Finland",
  status: "live",
  paramNotes: {
    area: "FI: optional. A region ('Uusimaa', 'Lapland', 'Pirkanmaa', 'Southwest Finland', 'Aland') or a main city ('Helsinki', 'Tampere', 'Turku', 'Oulu', 'Rovaniemi'), which is answered with its region. Leave out for the whole country.",
    stars: "FI: not used (Statistics Finland publishes no star split).",
  },
  examples: [
    { params: { country: "FI" } },
    { params: { country: "FI", area: "Helsinki" }, smoke: false },
    { params: { country: "FI", area: "Lapland" }, smoke: false },
  ],
  method:
    "Finland hotels: the average price per occupied hotel room per night that hotels report to Statistics Finland, by region and month. We pass on the latest published month with the change on a year earlier; it is an official average, not a range of bookings.",
  handle: (p, ctx) => fiHotels({ area: str(p.area), baseUrl: ctx.baseUrl }),
});
