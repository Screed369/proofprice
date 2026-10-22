// Manifest: Switzerland household electricity tariffs (ElCom via LINDAS / opendata.swiss). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, chElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["CH"],
  countryHelp: "CH = Switzerland (ElCom: published household electricity tariff per kWh, CHF, Switzerland or one canton)",
  placeName: "Switzerland",
  status: "live",
  paramNotes: {
    energy: "CH: electricity only (no gas). A published regulated tariff, shown as a posted price.",
    consumption_band: "CH: ElCom household profile H1 to H8 (default H4 = typical 5-room apartment with electric stove and dryer, about 4,500 kWh a year). The other profiles are listed in the answer.",
    taxes: "CH: one published total (energy + grid use + charges + federal aid fee); leave taxes out.",
  },
  extraParams: {
    canton: z.string().optional().describe("CH only: canton by two-letter code, for example 'ZH', 'GE', 'VD', 'TI'. Leave out for Switzerland as a whole."),
  },
  examples: [
    { params: { country: "CH", energy: "electricity" } },
    { params: { country: "CH", energy: "electricity", canton: "ZH" }, smoke: false },
  ],
  method:
    "Switzerland electricity: the household tariff ElCom publishes for a consumption profile (default H4), standard product, for Switzerland or one canton, newest tariff year, in CHF per kWh. A published tariff, not a count of paid bills.",
  handle: (p, ctx) => chElectricity({ energy: str(p.energy), canton: str(p.canton), consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
