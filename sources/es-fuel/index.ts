// Manifest: Spain live pump prices. Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { Fuel } from "../../lib/fuels";
import { INFO, esFuelNow, esHarvest, esHistoryKey, esBackfill } from "./source";
import { CROSS_CHECK } from "./crosscheck";

export default defineSource({
  info: INFO,
  category: "fuel",
  countries: ["ES"],
  countryHelp: "ES = Spain",
  placeName: "Spain",
  status: "live",
  // Outside check against the publisher's headline figure (internal, never shown): ./crosscheck.ts
  crossCheck: CROSS_CHECK,
  paramNotes: {
    postcode: "ES: 5-digit postcode, e.g. '28001'.",
    area: "ES: province code ('28' = Madrid).",
    town: "ES: town name, e.g. 'Valencia'.",
  },
  examples: [
    { params: { country: "ES", area: "42", fuel: "diesel" } },
    { params: { country: "ES", postcode: "28001", fuel: "petrol95" }, smoke: false },
  ],
  handle: (p, ctx) =>
    esFuelNow({
      postcode: str(p.postcode),
      area: str(p.area) ?? str(p.department),
      town: str(p.town),
      fuel: p.fuel as Fuel,
      baseUrl: ctx.baseUrl,
    }),
  harvest: esHarvest,
  backfill: esBackfill,
  historyKey: (p) => esHistoryKey({ postcode: str(p.postcode), area: str(p.area) ?? str(p.department), fuel: String(p.fuel) }),
});
