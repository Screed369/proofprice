// Manifest: Finland rents (Statistics Finland, average rent per m² of rented flats, table 15fa). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { finlandRent, INFO } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["FI"],
  countryHelp: "FI = Finland (official average rent per m² of market-rate rented flats from Statistics Finland, by town, region or district)",
  placeName: "Finland",
  status: "live",
  paramNotes: {
    town: "FI: optional: 'Helsinki', 'Espoo', 'Vantaa', 'Tampere', 'Turku', 'Oulu', 'Greater Helsinki', a region such as 'Uusimaa' or 'Pirkanmaa', or a district such as 'Helsinki 2'. Leave out for Finland as a whole.",
    postcode: "FI: not used.",
    property_type: "FI: not used (rented flats).",
    bedrooms: "FI: optional: the number of ROOMS the Finnish way (a living room counts): 1, 2 or 3 (3 means three or more). Leave out for all sizes.",
    months: "FI: ignored; the figure is for the newest quarter with at least 5 observations.",
  },
  examples: [
    { params: { country: "FI", town: "Helsinki" } },
    { params: { country: "FI", town: "Tampere", bedrooms: "2" }, smoke: false },
  ],
  method:
    "Finland: Statistics Finland's average rent per square metre of market-rate (non-subsidised) rented flats, with the number of observations behind it, by quarter, area and number of rooms (table 15fa). " +
    "We pass on the published average for the newest quarter with at least 5 observations. It is an average per m², not a list of rents.",
  handle: (p, ctx) => finlandRent({ town: str(p.town), bedrooms: num(p.bedrooms), baseUrl: ctx.baseUrl }),
});
