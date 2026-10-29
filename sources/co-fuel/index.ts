// Manifest: Colombia fuel (SICOM monthly station prices of vehicular natural gas). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, METHOD, coFuel, coHarvest, coHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["CO"],
  countryHelp: "CO = Colombia (compressed natural gas only, monthly station prices from SICOM; no gasoline or diesel)",
  placeName: "Colombia",
  status: "live",
  paramNotes: {
    fuel: "CO: only methane (vehicular natural gas, GNCV), in COP per cubic metre (not per kg). Gasoline and diesel are not available.",
    area: "CO: department, for example 'Antioquia', 'Cundinamarca', 'Valle del Cauca'. Empty = the whole country.",
    town: "CO: municipality, for example 'Medellin' or 'Cali'. Needs at least 5 reporting stations.",
    postcode: "CO: not used.",
    service: "CO: not used.",
  },
  examples: [{ params: { country: "CO", fuel: "methane" } }, { params: { country: "CO", fuel: "methane", area: "Antioquia" }, smoke: false }],
  method: METHOD,
  handle: (p, ctx) => coFuel({ fuel: str(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => coHarvest(),
  historyKey: (p) => coHistoryKey({ fuel: str(p.fuel), area: str(p.area), town: str(p.town) }),
  referenceDates: true,
});
