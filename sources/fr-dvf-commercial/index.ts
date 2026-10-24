// Manifest: France commercial premises and land sales (DVF, DGFiP via Etalab geo-dvf). Logic lives in ./source.ts.
import { defineSource, num, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { INFO, frCommercial, frHarvest, frHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "commercial-property",
  countries: ["FR"],
  countryHelp: "FR = France (DVF)",
  placeName: "France",
  status: "live",
  paramNotes: {
    town: "FR: town, e.g. 'Bordeaux', or use postcode.",
    postcode: "FR: 5-digit postcode, e.g. '33000'; use instead of town for a precise area.",
    property_type: "FR: commercial (default) or land. Alsace-Moselle and Mayotte are not covered.",
  },
  examples: [
    { params: { country: "FR", postcode: "69003", property_type: "commercial" } },
    { params: { country: "FR", town: "Toulouse", property_type: "land" } },
    { params: { country: "FR", postcode: "33000", property_type: "commercial" }, smoke: false },
  ],
  method:
    "France (DVF): price per m² of plain sales of exactly one commercial unit, or of ground with no building; sales that bundle homes or farmland are left out. DVF arrives with a delay of several months, so the period shown is the latest available.",
  // Stale-if-error copy and /history: the collector stores the 24-month median per m² for the arrondissements of Paris, Lyon, Marseille and the big cities.
  harvest: () => frHarvest(),
  historyKey: (p) => frHistoryKey({ postcode: str(p.postcode), town: str(p.town), property_type: str(p.property_type), months: num(p.months) }),
  referenceDates: true,
  handle: (p, ctx) => {
    if (!str(p.town) && !str(p.postcode)) throw new InputError("A French town or postcode is required.");
    return frCommercial({ postcode: str(p.postcode), town: str(p.town), property_type: str(p.property_type), months: num(p.months), baseUrl: ctx.baseUrl });
  },
});
