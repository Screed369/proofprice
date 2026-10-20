// Manifest: New Zealand household electricity (Electricity Authority, EMI regional power prices). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, nzElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["NZ"],
  countryHelp: "NZ = New Zealand (Electricity Authority: modelled average household electricity price per kWh incl. GST, by network region, NZD)",
  placeName: "New Zealand",
  status: "live",
  paramNotes: {
    energy: "NZ: electricity only (no gas). A modelled average from retail tariffs, shown as an official statistic.",
    consumption_band: "NZ: 'standard' (default, standard household user) or 'low' (low user).",
    taxes: "NZ: prices always include GST (15%); only 'all' (or leaving it out) works.",
  },
  extraParams: {
    region: z.string().optional().describe("NZ only: electricity network region, for example 'Auckland', 'Wellington', 'Christchurch', 'Dunedin'. Leave out for the unweighted median across all regions."),
  },
  examples: [
    { params: { country: "NZ", energy: "electricity", region: "Auckland" } },
    { params: { country: "NZ", energy: "electricity" }, smoke: false },
  ],
  method:
    "New Zealand electricity: the Electricity Authority's modelled average monthly bill for a typical household in a network region, divided by its monthly kWh, from the newest monthly file on the Electricity Market Information site. A modelled average from retail tariffs, not a count of paid bills.",
  handle: (p, ctx) => nzElectricity({ energy: str(p.energy), region: str(p.region), consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
