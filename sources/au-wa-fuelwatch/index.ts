// Manifest: Western Australia pump prices from FuelWatch's daily station file. Logic lives in ./source.ts. Answers come from the price library.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, servesWa, waFuelNow, waHarvest, waHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["AU"],
  countryHelp: "AU = Australia, Western Australia only (FuelWatch daily station prices)",
  placeName: "Western Australia",
  status: "live",
  paramNotes: {
    fuel: "Western Australia: diesel, petrol95 (= standard unleaded ULP, 91 RON), petrol98, lpg or e85.",
    area: "AU (Western Australia only): 'Perth' (the Metro region), 'WA' (the whole state), a FuelWatch region such as 'Peel' or 'South West', or a suburb name.",
    town: "AU (Western Australia only): suburb name, e.g. 'Rockingham'. Small suburbs may have fewer than 5 stations; use a postcode, 'Perth' or 'WA' then.",
    postcode: "AU (Western Australia only): 4-digit postcode starting with 6, e.g. '6000'.",
  },
  examples: [
    { params: { country: "AU", area: "Perth", fuel: "petrol95" } },
    { params: { country: "AU", postcode: "6168", fuel: "diesel" }, smoke: false },
    { params: { country: "AU", area: "WA", fuel: "petrol98" }, smoke: false },
  ],
  method:
    "Western Australia: median and range of the price per litre that each station notified to FuelWatch for the newest day (one price per station and fuel, GST included). A posted price, not a price paid.",
  // Australia has two station-level fuel sources: Queensland (au-qld-fuel) and Western Australia. A request is routed by postcode (6xxx) or place name.
  serves: (p) => servesWa({ area: str(p.area) ?? str(p.department), town: str(p.town), postcode: str(p.postcode) }),
  handle: (p, ctx) =>
    waFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: () => waHarvest(),
  historyKey: (p) => waHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), postcode: str(p.postcode), fuel: String(p.fuel) }),
});
