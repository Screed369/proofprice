// Manifest: EU national average pump prices from the European Commission's Weekly Oil Bulletin. Logic lives in ./source.ts.
// Answers come from the price library, filled by the collector from the bulletin's price-history workbook.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, INFO, wobFuelNow, wobBackfill, wobHarvest, wobHistoryKey } from "./source";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "EU Weekly Oil Bulletin, national average pump prices: " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", "),
  placeName: "the EU (national averages)",
  status: "live",
  paramNotes: {
    fuel: "EU Weekly Oil Bulletin countries: petrol95 (Euro-super 95), diesel (automotive gas oil) or lpg, as a national average per litre in euro with all taxes; heating gas oil is in the extra fields. Other fuels are not published.",
    postcode: "EU Weekly Oil Bulletin countries: not used; the bulletin publishes one national average per country, so the national figure is returned and says so.",
    area: "EU Weekly Oil Bulletin countries: not used (national average only).",
    town: "EU Weekly Oil Bulletin countries: not used (national average only).",
    service: "EU Weekly Oil Bulletin countries: not used.",
  },
  examples: [
    { params: { country: "IE", fuel: "diesel" } },
    { params: { country: "DE", fuel: "petrol95" }, smoke: false },
    { params: { country: "PL", fuel: "diesel" }, smoke: false },
  ],
  method:
    "EU national averages: the collector reads the European Commission's Weekly Oil Bulletin price history into our price library each day; answers are the national average pump price (all duties and taxes included) that the Commission publishes for the newest week, converted to euro per litre, with the change on the previous week and a year earlier. An official average, not a range of station prices.",
  handle: (p, ctx) =>
    wobFuelNow({
      country: String(p.country),
      fuel: String(p.fuel),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      postcode: str(p.postcode),
      baseUrl: ctx.baseUrl,
    }),
  // Stands in for the Italian, French and Spanish station-level sources when they cannot be reached and no recent copy is held
  // (MIMIT refuses connections from cloud servers): the answer is this bulletin's national figure and says so.
  fallbackFor: { sources: ["it-fuel", "fr-fuel", "es-fuel"], countries: ["IT", "FR", "ES"], label: "the European Commission Weekly Oil Bulletin" },
  nominalCounts: true,
  harvest: wobHarvest,
  backfill: wobBackfill,
  historyKey: (p) => wobHistoryKey({ country: String(p.country), fuel: String(p.fuel) }),
});
