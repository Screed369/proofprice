// Manifest: Portugal station-level pump prices (DGEG). Logic lives in ./source.ts. Free tier only (licence unclear on commercial use).
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, ptFuelNow, ptHarvest, ptHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["PT"],
  countryHelp: "PT = Portugal (mainland)",
  placeName: "Portugal (mainland)",
  status: "live",
  serves: (p) => {
    const c = String(p.country ?? "").toUpperCase();
    return c === "PT" && ["petrol95", "petrol98", "diesel", "lpg", "methane"].includes(String(p.fuel ?? ""));
  },
  paramNotes: {
    fuel: "PT: petrol95 (Gasolina simples 95), petrol98, diesel (Gasóleo simples), lpg (GPL Auto) or methane (CNG, per kg).",
    postcode: "PT: postcode such as '1000-001' or just the first 4 digits '1000'; with fewer than 5 stations the district is answered, labelled.",
    area: "PT: district name or number: 'Lisboa' (11), 'Porto' (13), 'Faro' (08) ... 18 mainland districts.",
    town: "PT: municipality (concelho), e.g. 'Cascais' or 'Sintra'; with fewer than 5 stations its district is answered, labelled. Without postcode, area or town the national figure is returned.",
  },
  examples: [
    { params: { country: "PT", area: "Lisboa", fuel: "diesel" } },
    { params: { country: "PT", town: "Cascais", fuel: "petrol95" }, smoke: false },
    { params: { country: "PT", fuel: "diesel" }, smoke: false },
    { params: { country: "PT", postcode: "4000", fuel: "petrol95" }, smoke: false },
  ],
  method:
    "Portugal: median and 10th–90th percentile of the current price each filling station reports to DGEG for the selected fuel, with the cheapest three stations; our daily copy of the same data gives history and stands in if the service is down.",
  handle: (p, ctx) =>
    ptFuelNow({ postcode: str(p.postcode), area: str(p.area) ?? str(p.department), town: str(p.town), fuel: p.fuel as Fuel, baseUrl: ctx.baseUrl }),
  harvest: ptHarvest,
  historyKey: (p) => ptHistoryKey({ area: str(p.area) ?? str(p.department), town: str(p.town), fuel: String(p.fuel) }),
});
