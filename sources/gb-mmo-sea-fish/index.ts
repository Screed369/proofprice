// Manifest: UK sea fish and shellfish, monthly landed price by species (Marine Management Organisation, Open Government Licence v3.0).
// Shares category "farm-gate-prices" with gb-defra-milk (milk): serves() sends fish to this source. The folder name sorts AFTER gb-defra-milk,
// which has no serves(): the registry takes the first source whose serves() says yes, otherwise the first for the country (milk).
import { defineSource, str } from "../../lib/plugin";
import { INFO, exampleSpecies, gbSeaFishHarvest, gbSeaFishHistoryKey, gbSeaFishMethod, gbSeaFishPrices, matchSpecies } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-gate-prices",
  countries: ["GB"],
  countryHelp: "GB = United Kingdom (MMO: monthly landed price paid to fishers for sea fish and shellfish, official statistic, not a shop price)",
  placeName: "the United Kingdom",
  status: "live",
  paramNotes: {
    product: `United Kingdom, sea fish and shellfish (monthly landed price per kg paid to fishers, from the Marine Management Organisation): ${exampleSpecies(24)}, or the groups demersal, pelagic, shellfish and all fish. Milk is answered by Defra.`,
    region: "United Kingdom sea fish: not needed. The MMO publishes one figure for all UK vessels and ports, so a region is answered with the UK figure and a note.",
  },
  examples: [
    { params: { country: "GB", product: "cod" } },
    { params: { country: "GB", product: "mackerel" }, smoke: false },
    { params: { country: "GB", product: "lobster" }, smoke: false },
  ],
  method: gbSeaFishMethod(),
  serves: (p) => matchSpecies(String(p.product ?? "")) !== null,
  handle: (p, ctx) => gbSeaFishPrices({ species: String(p.product ?? ""), region: str(p.region), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest month (one derived price per species), so a GOV.UK outage is answered from it (stale-if-error) and history builds up.
  harvest: () => gbSeaFishHarvest(),
  historyKey: (p) => gbSeaFishHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  nominalCounts: true,
});
