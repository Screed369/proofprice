// Manifest: Switzerland rents (BFS average net rent by canton and length of tenancy). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, num, str } from "../../lib/plugin";
import { INFO, chHarvest, chHistoryKey, chRents } from "./source";

export default defineSource({
  info: INFO,
  category: "rent",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (BFS: average net rent of tenant and co-operative homes by canton and length of tenancy; yearly)",
  placeName: "Switzerland",
  status: "live",
  paramNotes: {
    town: "CH: a canton (Zürich, Bern, Geneva, Vaud, Ticino or a code such as ZH, GE), or leave out for Switzerland as a whole. Towns and postcodes are not published.",
    postcode: "CH: not used (rents are published by canton); give the canton in town.",
    property_type: "CH: not split by property type; leave out.",
    bedrooms: "CH: not split by rooms or bedrooms in this table; leave out.",
    months: "CH: ignored; the figure is for the latest year published.",
  },
  extraParams: {
    tenancy_length: z
      .string()
      .optional()
      .describe("Switzerland only: how long the household has lived in the home: any (default), new_build, new_let (new let of a home older than 2 years), 2_5y, 6_10y, 11_20y or 21plus."),
  },
  examples: [
    { params: { country: "CH", town: "Zürich" } },
    { params: { country: "CH" }, smoke: false },
    { params: { country: "CH", town: "Geneva", tenancy_length: "new_let" }, smoke: false },
  ],
  method:
    "Switzerland rents: the average monthly net rent (without heating and service charges) of tenant and co-operative homes that the Federal Statistical Office (BFS) publishes each year from its Strukturerhebung survey, for Switzerland or a canton and by how long the household has lived in the home, with the published confidence interval. An official survey average, not a range of individual rents.",
  handle: (p, ctx) =>
    chRents({
      town: str(p.town),
      postcode: str(p.postcode),
      property_type: str(p.property_type),
      bedrooms: num(p.bedrooms),
      tenancy_length: str(p.tenancy_length),
      baseUrl: ctx.baseUrl,
    }),
  // Stale-if-error copy: the collector stores BFS's newest yearly averages (all cantons, all tenancy lengths) once a day.
  harvest: () => chHarvest(),
  historyKey: (p) =>
    chHistoryKey({ town: str(p.town), postcode: str(p.postcode), property_type: str(p.property_type), bedrooms: num(p.bedrooms), tenancy_length: str(p.tenancy_length) }),
  referenceDates: true,
  staleMaxDays: 35,
  nominalCounts: true,
  noHistory: "Switzerland: BFS publishes one average per canton and tenancy length each year, and ProofPrice keeps no separate history of it yet. Ask pricepaid_rent_prices (/api/v1/rent) for the newest figure.",
});
