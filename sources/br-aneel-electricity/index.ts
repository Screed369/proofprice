// Manifest: Brazil regulated residential electricity tariffs per distributor (ANEEL). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, brElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["BR"],
  countryHelp: "BR = Brazil (ANEEL: regulated residential electricity tariff per distributor, R$ per kWh before taxes)",
  placeName: "Brazil",
  status: "live",
  paramNotes: {
    energy: "BR: electricity only (no gas). The figure is the regulated residential tariff (TE energy + TUSD network) before taxes and flag surcharges, as a posted price.",
    consumption_band: "BR: not used (one residential tariff per distributor).",
    taxes: "BR: not used. ANEEL tariffs are always before taxes (ICMS, PIS/COFINS) and flag surcharges.",
  },
  extraParams: {
    distributor: z
      .string()
      .optional()
      .describe("BR only: the electricity distributor by ANEEL short name, for example 'CEMIG-D', 'ENEL SP', 'LIGHT', 'COPEL-DIS'. Leave out for the median of all distributors."),
  },
  examples: [
    { params: { country: "BR", energy: "electricity" } },
    { params: { country: "BR", energy: "electricity", distributor: "CEMIG-D" }, smoke: false },
  ],
  method:
    "Brazil energy: the regulated residential tariff (TE energy + TUSD network use) that ANEEL approved for each electricity distributor, in force today, in R$ per kWh before taxes and flag surcharges. " +
    "It is a posted tariff that applies to every customer of the distributor; without a distributor we give the median across distributors.",
  handle: (p, ctx) => brElectricity({ energy: String(p.energy), distributor: str(p.distributor), baseUrl: ctx.baseUrl }),
});
