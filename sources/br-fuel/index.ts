// Manifest: Brazil pump prices from ANP's weekly survey. Logic lives in ./source.ts. Answers come from the price library.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, brFuelNow, brHarvest, brHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["BR"],
  countryHelp: "BR = Brazil (ANP weekly survey: regular petrol and diesel S10)",
  placeName: "Brazil",
  status: "live",
  paramNotes: {
    fuel: "Brazil: petrol95 = regular petrol (gasolina comum, not RON 95) or diesel (= diesel S10). Other fuels are not covered.",
    area: "BR: state as a two-letter code or name ('SP', 'Minas Gerais'); leave empty for all Brazil.",
    town: "BR: municipality, e.g. 'São Paulo' or 'Curitiba'; add area when the name exists in several states.",
    postcode: "BR: not used (the survey is published by state and municipality).",
  },
  examples: [
    { params: { country: "BR", town: "São Paulo", fuel: "petrol95" } },
    { params: { country: "BR", area: "MG", fuel: "diesel" }, smoke: false },
  ],
  method:
    "Brazil: median and range of the pump selling prices ANP's weekly survey recorded at a sample of stations in the place (one price per station, 7 days ending on the survey date stated). ANP publishes monthly files, so the newest week is often one to four weeks old.",
  handle: (p, ctx) =>
    brFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: () => brHarvest(),
  historyKey: (p) => brHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), postcode: str(p.postcode), fuel: String(p.fuel) }),
});
