// Manifest: Netherlands daily national average pump prices (Statistics Netherlands, CBS table 80416NED). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { INFO, nlFuelHarvest, nlFuelHistoryKey, nlFuelNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["NL"],
  countryHelp: "NL = Netherlands (CBS: daily national average pump price, official statistic, a few days behind)",
  placeName: "the Netherlands",
  status: "live",
  // Shares NL with eu-oil-bulletin (weekly): this source answers every NL request; the bulletin keeps NL only for history.
  serves: (p) => String(p.country ?? "").toUpperCase() === "NL",
  paramNotes: {
    fuel: "Netherlands: petrol95 (Euro95), diesel or lpg, as a national daily average per litre in euro with VAT and excise. Premium petrol, E10, E85 and natural gas are not published.",
    postcode: "Netherlands: not used; CBS publishes one national average, so the national figure is returned and says so.",
    area: "Netherlands: not used (national average only).",
    town: "Netherlands: not used (national average only).",
    service: "Netherlands: not used.",
  },
  examples: [{ params: { country: "NL", fuel: "diesel" } }, { params: { country: "NL", fuel: "petrol95" }, smoke: false }],
  method:
    "Netherlands (fuel): Statistics Netherlands (CBS) publishes the national average pump price per litre of Euro95 petrol, diesel and LPG for every day (table 80416NED), weighted over almost all filling stations, VAT and excise included. " +
    "We pass on the published average for the newest day with the change on the previous week and a year earlier; no range is calculated.",
  handle: (p, ctx) => nlFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => nlFuelHarvest(),
  historyKey: (p) => nlFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Netherlands: ProofPrice keeps no separate daily history of the CBS series; ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest day, with the change on the previous week and a year earlier.",
});
