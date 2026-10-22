// Manifest: United States weekly residential heating oil and propane prices (EIA "Heating Oil and Propane Update"). Logic lives in ./source.ts.
// The daily collector (harvest) copies EIA's two history files into the price library; requests are answered from the library.
import { defineSource, str } from "../../lib/plugin";
import { INFO, usHeatingHarvest, usHeatingHistoryKey, usHeatingNow } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["US"],
  countryHelp: "US = United States (EIA: weekly national average residential heating oil and propane prices in US$ per gallon, October to March)",
  placeName: "the United States",
  status: "live",
  // Shares US with us-eia-fuel (gasoline and diesel): this source answers heating_oil and propane, that one everything else (declared serves() in both).
  serves: (p) => ["heating_oil", "propane"].includes(String(p.fuel ?? "")),
  paramNotes: {
    fuel: "US heating: heating_oil = residential No. 2 heating oil, propane = residential propane, as a national weekly average in US dollars per gallon (per litre in extra). Collected only October to March, so in summer the newest week is from March. For gasoline and diesel use petrol95 or diesel.",
    postcode: "US heating oil and propane: not used (national average only).",
    area: "US heating oil and propane: not used (national average only).",
    town: "US heating oil and propane: not used (national average only).",
    service: "US heating oil and propane: not used.",
  },
  examples: [{ params: { country: "US", fuel: "heating_oil" } }, { params: { country: "US", fuel: "propane" }, smoke: false }],
  method:
    "United States heating fuels: the average residential price of No. 2 heating oil and of propane that the U.S. Energy Information Administration estimates every week of the heating season (October to March), in US dollars per gallon for the whole country, with the change on the week and on the year. " +
    "We copy EIA's two history files once a day and pass on the published average; no range is calculated.",
  nominalCounts: true,
  harvest: usHeatingHarvest,
  historyKey: (p) => usHeatingHistoryKey({ fuel: String(p.fuel) }),
  handle: (p, ctx) => usHeatingNow({ fuel: String(p.fuel), area: str(p.area), town: str(p.town), postcode: str(p.postcode), baseUrl: ctx.baseUrl }),
});
