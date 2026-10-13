// Manifest: Italy daily pump prices (MIMIT Osservaprezzi). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, itFuelNow, itHarvest, itHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["IT"],
  countryHelp: "IT = Italy",
  placeName: "Italy",
  status: "live",
  paramNotes: {
    fuel: "Italy: diesel, petrol95, lpg, methane only.",
    area: "IT: province ('MI', 'RM').",
    town: "IT: comune name, e.g. 'Bologna'.",
    service: "IT: self-service (default) or attended service, which costs more.",
  },
  examples: [{ params: { country: "IT", area: "MI", fuel: "diesel" } }],
  method:
    "Italy: prices in force at 08:00 on the extraction day, self-service unless asked otherwise; prices not updated in 30 days are left out.",
  handle: (p, ctx) =>
    itFuelNow({
      area: str(p.area),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      service: str(p.service) === "served" ? "served" : "self",
      baseUrl: ctx.baseUrl,
    }),
  harvest: itHarvest,
  historyKey: (p) => itHistoryKey({ area: str(p.area), fuel: String(p.fuel), service: str(p.service) }),
});
