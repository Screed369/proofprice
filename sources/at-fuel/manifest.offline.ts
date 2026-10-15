// Manifest: Austria pump prices (E-Control Spritpreisrechner; cheapest stations per region only). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, atFuelNow, atHarvest, atHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["AT"],
  countryHelp: "AT = Austria (cheapest stations only)",
  placeName: "Austria",
  status: "live",
  paramNotes: {
    fuel: "Austria: diesel, petrol95 (Super 95) or methane (CNG) only.",
    postcode: "AT: 4-digit postcode, e.g. '1010'.",
    area: "AT: Bundesland code 1-9 ('9' = Wien) or a place name ('Wien', 'Tirol', 'Graz', 'Linz'); 3-digit district codes such as '901' also work. A small district may list fewer than 5 stations and then gives no figure.",
    town: "AT: city or district name, e.g. 'Graz'.",
  },
  examples: [
    { params: { country: "AT", area: "9", fuel: "diesel" } },
    { params: { country: "AT", area: "6", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Austria: E-Control's Spritpreisrechner returns only the cheapest stations for a region (about 10-15), so the median and range describe the cheap end of the market, not every station.",
  handle: (p, ctx) =>
    atFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: atHarvest,
  historyKey: (p) => atHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), fuel: String(p.fuel) }),
});
