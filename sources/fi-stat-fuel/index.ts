// Manifest: Finland monthly national average pump prices (Statistics Finland, table 12ge). Logic lives in ./source.ts.
// ROUTING: sources/eu-oil-bulletin also lists FI and its serves() says yes for FI, so until that one line excludes FI (like NL, which CBS answers)
// this source is never picked. That edit is in another source's folder, so it is raised as a platform task (Source Pipeline row, Simon is needed).
import { defineSource, str } from "../../lib/plugin";
import { INFO, fiFuelHarvest, fiFuelHistoryKey, fiFuelNow, fiFuelMethod } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["FI"],
  countryHelp: "FI = Finland (Statistics Finland: monthly national average pump price, official statistic, not a live pump price)",
  placeName: "Finland",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "FI" && ["petrol95", "diesel"].includes(String(p.fuel ?? "")),
  paramNotes: {
    fuel: "Finland: petrol95 (95 E10 unleaded) or diesel, as a national monthly average per litre in euro with VAT and duties. Premium petrol, E85, LPG, CNG, heating oil and renewable diesel are not served.",
    postcode: "Finland: not used; Statistics Finland publishes one national average, so the national figure is returned and says so.",
    area: "Finland: not used (national average only).",
    town: "Finland: not used (national average only).",
    service: "Finland: not used.",
  },
  examples: [{ params: { country: "FI", fuel: "diesel" } }, { params: { country: "FI", fuel: "petrol95" }, smoke: false }],
  method: fiFuelMethod(),
  handle: (p, ctx) => fiFuelNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
  harvest: () => fiFuelHarvest(),
  historyKey: (p) => fiFuelHistoryKey({ fuel: str(p.fuel) }),
  referenceDates: true,
  nominalCounts: true,
  noHistory: "Finland: Statistics Finland publishes one average per fuel and month; ProofPrice keeps no daily history of it. Ask pricepaid_fuel_prices_now (/api/v1/fuel) for the newest month, with the change on the previous month and a year earlier.",
});
