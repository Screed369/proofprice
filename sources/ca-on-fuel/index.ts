// Manifest: Ontario fuel prices (Ontario Ministry of Energy, Fuels Price Survey, weekly). Logic lives in ./source.ts.
// Shares CA with ca-statcan-fuel: this source answers the Ontario-only markets (and the Ontario averages), that one everything else (declared serves() in both).
import { defineSource, str } from "../../lib/plugin";
import { INFO, isOntarioOnlyPlace, onFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["CA"],
  countryHelp: "CA = Canada (Ontario markets only here: Ministry of Energy weekly average pump price in CAD per litre; other Canadian places come from Statistics Canada)",
  placeName: "Ontario",
  status: "live",
  serves: (p) => isOntarioOnlyPlace(String(p.town ?? p.area ?? "")),
  paramNotes: {
    fuel: "Ontario: petrol95 = regular unleaded, petrol98 = premium unleaded, diesel, propane, methane = compressed natural gas (per litre of gasoline equivalent). E10, E85, LPG and heating oil are not published.",
    town: "Ontario: one of Windsor, London, Peterborough, St. Catharines, Sudbury, Sault Ste. Marie, North Bay, Timmins, Kenora, Parry Sound, Toronto East, Toronto West, or Ontario / Southern Ontario / Northern Ontario for the averages. Ottawa, Thunder Bay and Toronto (city) are answered from Statistics Canada.",
    area: "Ontario: same as town (a market, or Ontario / Southern Ontario / Northern Ontario).",
    postcode: "Ontario: not used.",
    service: "Ontario: not used (the survey does not split self and full service).",
  },
  examples: [
    { params: { country: "CA", town: "Windsor", fuel: "diesel" } },
    { params: { country: "CA", town: "Ontario", fuel: "propane" }, smoke: false },
  ],
  method:
    "Ontario fuel: the Ontario Ministry of Energy's weekly Fuels Price Survey, the average pump price per litre in one of its Ontario markets (or the Ontario average) for the newest week, with the change on the week and the year. " +
    "A posted pump price average, not what each driver paid; we pass it on as published and calculate no range.",
  handle: (p, ctx) =>
    onFuelNow({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), service: str(p.service), baseUrl: ctx.baseUrl }),
});
