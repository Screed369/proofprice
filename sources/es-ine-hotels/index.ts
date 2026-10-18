// Manifest: Spain hotel room prices (INE hotel survey, average daily rate). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, esHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["ES"],
  countryHelp: "ES = Spain (INE hotel survey, average price charged per occupied room per night, in euro)",
  placeName: "Spain",
  status: "live",
  paramNotes: {
    area: "ES: optional. A region ('Andalucia', 'Cataluña', 'Madrid'), a province ('Málaga', 'Cádiz', 'Illes Balears') or a tourist city or resort ('Benidorm', 'Barcelona', 'Alicante') as INE names them; accents are optional. Leave out for the Spain-wide average. A name that is both a province and a city gives the province and lists the other.",
    stars: "ES: optional, 1 to 5 hotel stars. INE publishes star categories for Spain as a whole only, so do not combine with area.",
  },
  examples: [
    { params: { country: "ES" } },
    { params: { country: "ES", area: "Benidorm" }, smoke: false },
    { params: { country: "ES", stars: "4" }, smoke: false },
  ],
  method:
    "Spain hotels: the average daily rate that INE (the national statistics office) publishes every month from its hotel survey, the average price actually charged per occupied room per night, for Spain, a region, province or tourist site, or a star category for Spain. We pass on the latest published month with INE's change on a year earlier; it is an official average, not a range of bookings.",
  handle: (p, ctx) => esHotels({ area: str(p.area), stars: num(p.stars), baseUrl: ctx.baseUrl }),
});
