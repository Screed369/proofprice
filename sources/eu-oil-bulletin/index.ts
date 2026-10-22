// Manifest: EU national average pump prices from the European Commission's Weekly Oil Bulletin. Logic lives in ./source.ts.
// Answers come from the price library, filled by the collector from the bulletin's price-history workbook.
import { z } from "zod";
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
  // NL is answered by the daily CBS source (nl-cbs-fuel); the bulletin keeps NL for its weekly history.
  serves: (p) => String(p.country ?? "").toUpperCase() !== "NL",
  paramNotes: {
    fuel: "EU Weekly Oil Bulletin countries: petrol95 (Euro-super 95), diesel (automotive gas oil) or lpg, as a national average per litre in euro with all taxes; heating gas oil is in the extra fields. Other fuels are not published.",
    postcode: "EU Weekly Oil Bulletin countries: not used; the bulletin publishes one national average per country, so the national figure is returned and says so.",
    area: "EU Weekly Oil Bulletin countries: not used (national average only).",
    town: "EU Weekly Oil Bulletin countries: not used (national average only).",
    service: "EU Weekly Oil Bulletin countries: not used.",
  },
  extraParams: {
    tax: z
      .enum(["with", "without"])
      .optional()
      .describe(
        "EU Weekly Oil Bulletin countries only: 'with' (default) = the pump price with all duties and taxes; 'without' = the Commission's price net of duties and taxes (VAT and excise removed), the basis many fuel-surcharge indices use. The answer states which. Other countries ignore it and answer with their own pump price.",
      ),
  },
  examples: [
    { params: { country: "IE", fuel: "diesel" } },
    { params: { country: "IE", fuel: "diesel", tax: "without" }, smoke: false },
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
      tax: str(p.tax),
      baseUrl: ctx.baseUrl,
    }),
  // Stands in for the Italian, French and Spanish station-level sources when they cannot be reached and no recent copy is held
  // (MIMIT refuses connections from cloud servers): the answer is this bulletin's national figure and says so.
  fallbackFor: { sources: ["it-fuel", "fr-fuel", "es-fuel"], countries: ["IT", "FR", "ES"], label: "the European Commission Weekly Oil Bulletin" },
  nominalCounts: true,
  harvest: wobHarvest,
  backfill: wobBackfill,
  historyKey: (p) => wobHistoryKey({ country: String(p.country), fuel: String(p.fuel), tax: str(p.tax) }),
});
