// Manifest: US rents (Census Bureau, American Community Survey 5-year, median gross rent B25064). Logic lives in ./source.ts.
// The daily collector reads the Census files once; requests are answered from the price library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, usRent, usRentHarvest, usRentHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["US"],
  countryHelp: "US = United States (official median gross rent from the Census Bureau's American Community Survey, for the country, states, counties, metro areas and cities of 50,000+ people)",
  placeName: "United States",
  status: "live",
  paramNotes: {
    town: "US: optional: a city with its state ('Seattle', 'Portland, OR', 'Austin, Texas'), a county ('King County, Washington'), a metro area ('Boston') or a state ('Texas'). Cities of 50,000+ people only. Leave out for the whole United States. A name shared by several places lists them so you can add the state.",
    postcode: "US: not used.",
    property_type: "US: not used (all rented homes).",
    bedrooms: "US: not used (all sizes).",
    months: "US: ignored; the figure is the latest 5-year estimate.",
  },
  examples: [
    { params: { country: "US", town: "Seattle" } },
    { params: { country: "US", town: "Texas" }, smoke: false },
  ],
  method:
    "United States: the Census Bureau's American Community Survey 5-year median gross rent (rent plus utilities) of tenants paying cash rent, table B25064, collected once a day into our price library and passed on as published. " +
    "A survey estimate over five years, not a list of rents.",
  handle: (p, ctx) => usRent({ town: str(p.town), baseUrl: ctx.baseUrl }),
  harvest: () => usRentHarvest(),
  historyKey: (p) => usRentHistoryKey({ town: str(p.town) }),
  referenceDates: true,
  staleMaxDays: 45,
  nominalCounts: true,
  noHistory: "US rents: the Census Bureau publishes one 5-year median per area each year, and ProofPrice has no rent history tool. Ask pricepaid_rent_prices (/api/v1/rent) for the latest figure.",
});
