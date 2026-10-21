// Manifest: Queensland pump prices (Fuel Price Reporting, monthly). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, qldFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["AU"],
  countryHelp: "AU = Australia, Queensland only (monthly station prices reported to the Queensland Government)",
  placeName: "Queensland",
  status: "live",
  paramNotes: {
    fuel: "Queensland: diesel, petrol95 (= standard Unleaded, 91 RON), petrol98, e10, e85 or lpg.",
    area: "AU (Queensland only): 'Brisbane' (postcodes 4000 to 4179) or 'QLD' (the whole state). A suburb name also works.",
    town: "AU (Queensland only): suburb name, e.g. 'Mount Gravatt'. Small suburbs may have fewer than 5 stations.",
    postcode: "AU (Queensland only): 4-digit postcode starting with 4, e.g. '4122'. Most single postcodes have fewer than 5 stations of one fuel; use area 'Brisbane' or 'QLD' then.",
  },
  examples: [
    { params: { country: "AU", area: "Brisbane", fuel: "diesel" } },
    { params: { country: "AU", area: "QLD", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Queensland: each station's latest reported price per litre in the newest published month of the Queensland Government Fuel Price Reporting dataset. A posted price, a month or more old.",
  handle: (p, ctx) =>
    qldFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
});
