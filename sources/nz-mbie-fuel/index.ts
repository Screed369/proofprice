// Manifest: New Zealand fuel (MBIE weekly fuel price monitoring). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nzFuel } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (MBIE weekly national average retail price; an official statistic, not a station price)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: {
    fuel: "NZ: diesel, or petrol95 (MBIE's Premium Petrol 95R; petrol98 gets the same series). Regular petrol 91 is returned in extra.other_fuels.",
    town: "NZ: not used. MBIE publishes one national price per week; any place is answered with the New Zealand average and the answer says so.",
    area: "NZ: not used (national price only).",
    postcode: "NZ: not used (national price only).",
    service: "NZ: not used.",
  },
  examples: [
    { params: { country: "NZ", fuel: "diesel" } },
    { params: { country: "NZ", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "New Zealand fuel: MBIE's weekly national 'Adjusted retail price' of diesel and premium petrol 95R (and regular 91 in the extras) for the newest week, with the change on the week and the year. A national official statistic, not a station price.",
  handle: (p, ctx) => nzFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
});
