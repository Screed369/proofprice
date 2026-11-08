// Manifest: France oilseeds, pulses and minor cereals, average price paid to producers (FranceAgriMer quarterly survey). Logic lives in ./source.ts.
// Shares country FR with eu-farm-prices (European Commission weekly prices): serves() sends only the crops below here; wheat, durum, barley, maize,
// rye, oats and triticale stay with eu-farm-prices. The folder name sorts AFTER eu-farm-prices on purpose (the fallback source for FR stays the EU portal).
import { defineSource, str } from "../../lib/plugin";
import { exampleCrops, famGrainPrices, famHarvest, famHistoryKey, famMethod, INFO, matchCrop } from "./source";

export default defineSource({
  info: INFO,
  category: "farm-prices",
  countries: ["FR"],
  countryHelp:
    "FR = France (FranceAgriMer: quarterly average prices paid to producers for rapeseed, sunflower, peas, soya and other oilseeds, pulses and minor cereals; wheat, barley, maize and other main cereals come from the EU portal)",
  placeName: "France",
  status: "live",
  serves: (p) => String(p.country ?? "").toUpperCase() === "FR" && matchCrop(p.product) !== null,
  paramNotes: {
    product: `FR: ${exampleCrops()} (FranceAgriMer's quarterly national average paid to producers, euro per tonne, cumulative since the start of the July-June campaign). Wheat, durum, barley, maize, rye, oats and triticale for France are answered from the European Commission portal.`,
  },
  examples: [
    { params: { country: "FR", product: "rapeseed" } },
    { params: { country: "FR", product: "sunflower" }, smoke: false },
    { params: { country: "FR", product: "peas" }, smoke: false },
  ],
  method: famMethod(),
  handle: (p, ctx) => famGrainPrices({ product: str(p.product), baseUrl: ctx.baseUrl }),
  // A daily copy of the newest quarter, so a FranceAgriMer outage is answered from it (stale-if-error). Each row is one published average (n is NO_COUNT).
  harvest: () => famHarvest(),
  historyKey: (p) => famHistoryKey({ product: str(p.product) }),
  referenceDates: true,
  staleMaxDays: 90,
  nominalCounts: true,
});
