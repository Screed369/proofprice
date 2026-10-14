// Manifest: United States weekly retail gasoline and diesel prices (EIA, "Gasoline and Diesel Fuel Update"). Logic lives in ./source.ts.
// The daily collector (harvest) copies EIA's two history files into the price library; requests are answered from the library.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, usFuelHarvest, usFuelHistoryKey, usFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["US"],
  countryHelp:
    "US = United States (U.S. Energy Information Administration: weekly average retail gasoline and diesel prices in US$ per gallon for the nation, PADD regions, 9 states and 10 cities)",
  placeName: "the United States",
  status: "live",
  paramNotes: {
    fuel:
      "US: petrol95 = regular gasoline, petrol98 = premium gasoline, diesel = on-highway diesel (all types). For midgrade gasoline use petrol95 with gasoline_grade=midgrade. " +
      "Prices are weekly averages in US dollars per gallon, taxes included (US$ per litre is in extra). EIA publishes no E10, E85, LPG or CNG prices.",
    area:
      "US: a state ('TX', 'California') or PADD region ('Gulf Coast', 'PADD 1B', 'West Coast'); leave empty for the national average. EIA publishes gasoline for CA, CO, FL, MA, MN, NY, OH, TX and WA, " +
      "diesel only for California plus the nation and PADD regions. Any other place gets the national average, and the answer says so (with its region as context).",
    town:
      "US: one of the ten cities EIA publishes (Boston, Chicago, Cleveland, Denver, Houston, Los Angeles, Miami, New York City, San Francisco, Seattle), gasoline only; otherwise the national average is returned and the answer says so.",
    postcode: "US: not used (EIA publishes no ZIP-code prices).",
    service: "US: not used.",
  },
  extraParams: {
    gasoline_grade: z
      .enum(["regular", "midgrade", "premium"])
      .optional()
      .describe("US only: the gasoline grade EIA publishes. Overrides the grade implied by fuel (petrol95 = regular, petrol98 = premium); use midgrade here with fuel=petrol95. Not for diesel."),
  },
  examples: [
    { params: { country: "US", fuel: "petrol95" } },
    { params: { country: "US", fuel: "diesel", area: "California" }, smoke: true },
    { params: { country: "US", fuel: "petrol95", gasoline_grade: "midgrade", area: "TX" }, smoke: false },
  ],
  method:
    "United States fuel: the average retail price (taxes included) of regular, midgrade and premium gasoline and of on-highway diesel that the U.S. Energy Information Administration estimates every week, in US dollars per gallon, " +
    "for the nation, its PADD regions, nine states and ten cities (diesel: nation, regions and California), with the change on the week and on the year. We copy EIA's two history files once a day and pass on the published average; no range is calculated.",
  harvest: usFuelHarvest,
  historyKey: (p) => usFuelHistoryKey({ fuel: String(p.fuel), gasoline_grade: str(p.gasoline_grade), area: str(p.area), town: str(p.town) }),
  handle: (p, ctx) =>
    usFuelNow({
      fuel: String(p.fuel),
      gasoline_grade: str(p.gasoline_grade),
      area: str(p.area),
      town: str(p.town),
      postcode: str(p.postcode),
      baseUrl: ctx.baseUrl,
    }),
});
