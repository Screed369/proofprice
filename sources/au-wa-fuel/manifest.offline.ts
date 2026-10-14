// Manifest: Western Australia pump prices (FuelWatch RSS). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, auFuelNow, auHarvest, auHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["AU"],
  countryHelp: "AU = Australia, Western Australia only (FuelWatch)",
  placeName: "Western Australia",
  status: "live",
  paramNotes: {
    fuel: "Western Australia: diesel, petrol95 (= standard unleaded ULP, 91 RON), petrol98, lpg or e85.",
    area: "AU (Western Australia only): 'Perth' (whole metropolitan area), 'WA' (whole state), or a suburb name.",
    town: "AU (Western Australia only): suburb name, e.g. 'Rockingham' (neighbouring suburbs are included; small suburbs may have fewer than 5 stations).",
    postcode: "AU: not used; FuelWatch is organised by suburb.",
  },
  examples: [
    { params: { country: "AU", area: "Perth", fuel: "petrol95" } },
    { params: { country: "AU", town: "Rockingham", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Western Australia: the standard cash price per litre that every WA fuel retailer notifies to FuelWatch for the day; membership-only stations are left out. Standard unleaded (ULP) is 91 RON in Australia.",
  handle: (p, ctx) =>
    auFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: auHarvest,
  historyKey: (p) => auHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), postcode: str(p.postcode), fuel: String(p.fuel) }),
});
