// Manifest: Mexico pump prices from the regulator's (CRE) open feeds. Logic lives in ./source.ts. Answers come from the price library.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, mxFuelNow, mxHarvest, mxHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["MX"],
  countryHelp: "MX = Mexico (by state)",
  placeName: "Mexico",
  status: "live",
  paramNotes: {
    fuel: "Mexico: petrol95 = regular petrol (gasolina regular, Magna), petrol98 = premium petrol, or diesel. Mexican grades are not 95 or 98 RON.",
    area: "MX: state name or code ('Ciudad de México', 'CDMX', 'Jalisco', 'NLE'); leave empty for all Mexico. Only states are available.",
    town: "MX: not used for cities; a state name given here works like area.",
    postcode: "MX: not used.",
  },
  examples: [
    { params: { country: "MX", area: "Ciudad de México", fuel: "petrol95" } },
    { params: { country: "MX", area: "Jalisco", fuel: "diesel" }, smoke: false },
  ],
  method:
    "Mexico: median and range of the pump prices that stations report to the regulator (CRE) in its public feeds, by state (the feeds give coordinates, from which ProofPrice assigns the state). Regular and premium are Mexican grades, not RON 95/98.",
  handle: (p, ctx) =>
    mxFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: () => mxHarvest(),
  historyKey: (p) => mxHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), postcode: str(p.postcode), fuel: String(p.fuel) }),
});
