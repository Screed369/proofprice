// Manifest: Sweden household electricity prices by consumption band, half-yearly (Statistics Sweden SCB table TAB4310). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { BANDS, DEFAULT_BAND, INFO, seEnergy, seMethod } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["SE"],
  countryHelp: "SE = Sweden (Statistics Sweden SCB: average household electricity price in SEK per kWh by consumption band, half-yearly, official statistic)",
  placeName: "Sweden",
  status: "live",
  // Shares SE with eu-energy (Eurostat): this source answers household electricity for SE; eu-energy keeps SE gas and the business sector.
  serves: (p) => p.sector !== "business" && String(p.country ?? "").toUpperCase() === "SE" && String(p.energy ?? "") === "electricity",
  paramNotes: {
    energy: "Sweden: electricity only (SCB publishes no household gas price); SEK per kWh, a national average.",
    consumption_band: `Sweden, annual consumption: ${BANDS.map((b) => `${b.code} = ${b.help}`).join("; ")}; default ${DEFAULT_BAND}.`,
    taxes: "Sweden: all = SCB's total with electricity tax and VAT (default); excl_vat and none are calculated by ProofPrice from SCB's published parts.",
  },
  examples: [{ params: { country: "SE", energy: "electricity" } }, { params: { country: "SE", energy: "electricity", consumption_band: "DD" }, smoke: false }],
  method: seMethod(),
  handle: (p, ctx) => seEnergy({ consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
