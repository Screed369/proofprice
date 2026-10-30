// Manifest: Ontario (Canada) hotel room prices (Ministry of Tourism, Culture and Gaming hotel statistics, average daily rate). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, caHotels } from "./source";

export default defineSource({
  info: INFO,
  category: "hotels",
  countries: ["CA"],
  countryHelp: "CA = Canada, Ontario only (Ministry of Tourism, Culture and Gaming: average daily rate per occupied hotel room per night, in Canadian dollars)",
  placeName: "Ontario, Canada",
  status: "live",
  paramNotes: {
    area: "CA: optional. An Ontario tourism region or city as the Ministry names it (for example 'Toronto', 'Niagara'); leave out for the Ontario-wide average. Other provinces are not covered.",
  },
  examples: [{ params: { country: "CA" } }, { params: { country: "CA", area: "Toronto" }, smoke: false }],
  method:
    "Ontario hotels: the average daily rate that Ontario's Ministry of Tourism, Culture and Gaming publishes every month, the average room revenue per occupied room per night, for Ontario or one of its areas. We pass on the newest published month; it is an official average, not a range of bookings.",
  handle: (p, ctx) => caHotels({ area: str(p.area), baseUrl: ctx.baseUrl }),
});
