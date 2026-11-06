// Manifest: Ireland hotel and accommodation prices paid by foreign visitors (CSO table ITA12). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, ieHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["IE"],
  countryHelp: "IE = Ireland (CSO visitor survey: mean nightly accommodation cost paid by foreign visitors, yearly, in EUR)",
  placeName: "Ireland",
  status: "live",
  paramNotes: {
    area: "IE: national only. Here 'area' is the visitors' home market, not a place in Ireland: Great Britain, USA & Canada, Other Europe or Other. Leave out for all foreign visitors.",
    stars: "IE: not used (the CSO publishes no star split).",
  },
  extraParams: {
    accommodation: z.string().optional().describe("IE only: hotels (default), guest house (B&B), self catering, other private, or all types."),
  },
  examples: [
    { params: { country: "IE", area: "Great Britain" } },
    { params: { country: "IE", accommodation: "guest house" }, smoke: false },
  ],
  method:
    "Ireland hotels: the mean nightly accommodation cost that overnight foreign resident visitors report to the Central Statistics Office, by visitor home market and accommodation type, yearly. An official survey mean, not a rate card or a range of bookings.",
  handle: (p, ctx) => ieHotels({ area: str(p.area), accommodation: str(p.accommodation), baseUrl: ctx.baseUrl }),
});
