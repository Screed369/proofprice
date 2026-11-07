// Manifest: Canada sea fish and shellfish, annual landed value per kg (Fisheries and Oceans Canada, "Commercial Fisheries, Canada, annual").
// Shares category "farm-gate-prices" with ca-farm-prices (Statistics Canada, monthly crops and livestock): serves() sends fish to this source.
// The folder name sorts AFTER ca-farm-prices on purpose: the registry falls back to the first source for the country when no serves() says yes.
import { defineSource, str } from "../../lib/plugin";
import { INFO, caFisheriesHarvest, caFisheriesHistoryKey, caFisheriesMethod, caFisheriesPrices, exampleSpecies, matchSpecies } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["CA"],
  countryHelp: "CA = Canada (Fisheries and Oceans Canada: annual average landed value of sea fish and shellfish, official statistic, not a live price)",
  placeName: "Canada",
  status: "live",
  paramNotes: {
    product: `Canada, sea fish and shellfish (annual landed value per kg paid to fishers, from Fisheries and Oceans Canada): ${exampleSpecies(24)}. Crops and livestock (wheat, milk, hogs ...) are answered by Statistics Canada.`,
    region:
      "Canada sea fish: optional. Leave out for Canada as a whole, or give Atlantic, British Columbia, Nova Scotia, New Brunswick, Prince Edward Island, Newfoundland and Labrador or Quebec. (Crops and livestock need a province.)",
  },
  examples: [
    { params: { country: "CA", product: "lobster" } },
    { params: { country: "CA", product: "salmon", region: "British Columbia" }, smoke: false },
    { params: { country: "CA", product: "snow crab", region: "Newfoundland and Labrador" }, smoke: false },
  ],
  method: caFisheriesMethod(),
  serves: (p) => matchSpecies(String(p.product ?? "")) !== null,
  handle: (p, ctx) => caFisheriesPrices({ species: String(p.product ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest year (one derived average per species and area), so a DFO outage is answered from it (stale-if-error).
  harvest: () => caFisheriesHarvest(),
  historyKey: (p) => caFisheriesHistoryKey({ product: str(p.product), region: str(p.region) }),
  referenceDates: true,
  nominalCounts: true,
});

