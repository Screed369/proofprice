// Manifest: US average domestic airfares from the Department of Transportation's Consumer Airfare Report. Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, usAirfares } from "./source";

export default defineSource({
  info: INFO,
  category: "flights",
  countries: ["US"],
  countryHelp: "US = United States, contiguous 48 states (domestic flights only; Alaska, Hawaii and territories are not covered)",
  placeName: "the United States (domestic flights within the contiguous 48 states)",
  status: "live",
  paramNotes: {
    from: "US: airport code (JFK, ORD) or city ('Chicago', 'Portland, OR', 'New York'). Airports in one metro area share one city market for city-level questions.",
    to: "US: airport code or city. Two airports give the airport-pair average where DOT publishes it; otherwise (and for cities) the city-pair average.",
    quarters: "US: the trend lists this many quarters, newest first. DOT publishes about five to six months after a quarter ends.",
  },
  examples: [
    { params: { country: "US", from: "JFK", to: "LAX" } },
    { params: { country: "US", from: "Chicago", to: "Miami" }, smoke: false },
    { params: { country: "US", from: "Boston" }, smoke: false },
  ],
  method:
    "US: the average each-way fare that the Department of Transportation publishes every quarter in its Consumer Airfare Report, for an airport pair (Table 1a), a city pair (Table 6) or, with only a departure city, that city's busiest routes (Table 2). We pass on the published figure for the latest quarter; it is an average over all tickets sold, not a current fare.",
  handle: (p, ctx) =>
    usAirfares({
      from: str(p.from),
      to: str(p.to),
      quarters: num(p.quarters),
      baseUrl: ctx.baseUrl,
    }),
});
