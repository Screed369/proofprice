// Manifest: United States rents (Census Bureau ACS 5-year median gross rent, table B25064). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { INFO, usRent, usRentHarvest, usRentHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["US"],
  countryHelp: "US = United States (Census Bureau American Community Survey median gross rent, official survey estimate, by state, county and city)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    town:
      "US: optional. A state ('Texas' or 'TX'), a county ('Travis County, Texas') or a city or town with its state ('Austin, Texas'; for New York City use 'New York city, New York' or 'NYC'). Leave out for the whole United States. A name used in several states needs the state.",
    postcode: "US: not used (the figures are by state, county and place); give the place as town.",
    property_type: "US: not used; the figure is for all renter-occupied homes paying cash rent.",
    bedrooms: "US: not available; the figure is for homes of all sizes together.",
    months: "US: ignored; the figure is the newest ACS 5-year release, stated in the answer.",
    house_type: "US: not used.",
  },
  examples: [
    { params: { country: "US", town: "Austin, Texas" } },
    { params: { country: "US", town: "California" }, smoke: false },
    { params: { country: "US" }, smoke: false },
  ],
  method:
    "United States: the Census Bureau's American Community Survey 5-year estimate of the median gross rent (contract rent plus the utilities the tenant pays) of renter-occupied homes paying cash rent, for the whole country, each state, county and city, with its 90% margin of error; an official survey estimate, not a list of rents and not an asking rent. Our collector reads the Bureau's published summary files and every answer comes from that copy.",
  handle: (p, ctx) =>
    usRent({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      house_type: str(p.house_type),
      bedrooms: num(p.bedrooms),
      baseUrl: ctx.baseUrl,
    }),
  harvest: usRentHarvest,
  historyKey: (p) => usRentHistoryKey({ town: str(p.town) }, (readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area)),
  referenceDates: true,
  nominalCounts: true,
});
