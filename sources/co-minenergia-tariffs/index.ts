// Manifest: Colombia regulated electricity unit cost of supply (CU) for four utility areas (datos.gov.co, dataset ytme-6qnu). Logic lives in ./source.ts.
// Free tier only: the dataset is CC BY-SA 4.0 and the reuse of derived figures is not yet cleared (Notion Source Pipeline, 30 Oct 2026).
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, coElectricity } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["CO"],
  countryHelp: "CO = Colombia (regulated electricity unit cost of supply, COP per kWh, for four utility areas only: Bogotá, Cali, Valle del Cauca, Tolima; a posted tariff component)",
  placeName: "Colombia (four utility areas)",
  status: "live",
  paramNotes: {
    energy: "CO: electricity only (no gas).",
    consumption_band: "CO: the voltage level: '1' (default: households and small users), '2' or '3'.",
    taxes: "CO: not used; the figure is the regulated unit cost (CU) before taxes, subsidies and contributions.",
  },
  extraParams: {
    operator: z.string().optional().describe("CO only: the utility area: 'bogota' (default, ENEL Bogotá), 'cali' (EMCALI), 'valle' (CELSIA Valle del Cauca) or 'tolima' (CELSIA Tolima). No other part of Colombia is covered."),
  },
  examples: [
    { params: { country: "CO", energy: "electricity" } },
    { params: { country: "CO", energy: "electricity", operator: "cali" }, smoke: false },
  ],
  method:
    "Colombia electricity: the regulated unit cost of supply (CU, COP per kWh) listed on datos.gov.co for four utility areas, newest month. A regulated tariff component, not a bill and not an amount paid.",
  handle: (p, ctx) =>
    coElectricity({ energy: str(p.energy), consumption_band: str(p.consumption_band), operator: str(p.operator), baseUrl: ctx.baseUrl }),
});
