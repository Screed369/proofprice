// Manifest: Czechia fuel (CZSO weekly national average pump prices, CZK). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, czFuel, czFuelHarvest, czFuelHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["CZ"],
  countryHelp: "CZ = Czechia (Czech Statistical Office weekly national average pump price in koruna; an official statistic, not a station price)",
  placeName: "Czechia",
  status: "live",
  // Shares CZ with eu-oil-bulletin (euro, with a tax=without option). This source answers diesel, petrol95 and lpg in koruna; tax=without
  // and every other fuel (heating oil) stay with the bulletin.
  serves: (p) => String(p.country ?? "").toUpperCase() === "CZ" && ["diesel", "petrol95", "lpg"].includes(String(p.fuel ?? "")) && str(p.tax) !== "without",
  paramNotes: {
    fuel: "CZ: diesel, petrol95 or lpg, as the weekly national average per litre in Czech koruna (CZSO). E10, E85, CNG and petrol 98 are not published. For the euro figure or the price net of tax (tax=without) the EU Oil Bulletin answers.",
    town: "CZ: not used. One national price per week; any place is answered with the Czech average and the answer says so.",
    area: "CZ: not used (national price only).",
    postcode: "CZ: not used (national price only).",
  },
  examples: [
    { params: { country: "CZ", fuel: "diesel" } },
    { params: { country: "CZ", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Czechia fuel: the Czech Statistical Office's weekly national average consumer price of diesel, petrol 95 and LPG in koruna per litre for the newest week, with the change on four weeks and a year earlier. A national official statistic, not a station price.",
  handle: (p, ctx) => czFuel({ fuel: str(p.fuel), town: str(p.town), area: str(p.area), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => czFuelHarvest(),
  historyKey: (p) => czFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Czechia: ProofPrice keeps no separate daily history of the CZSO weekly series; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest week, with the change on four weeks and a year earlier.",
});
