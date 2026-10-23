// Manifest: Finland household electricity prices by consumption band, monthly (Statistics Finland table 13rb). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { BANDS, DEFAULT_BAND, INFO, fiEnergy, fiHarvest, fiHistoryKey, fiMethod } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["FI"],
  countryHelp: "FI = Finland (Statistics Finland: average household electricity price in euro per kWh by consumption band, monthly, official statistic)",
  placeName: "Finland",
  status: "live",
  // Shares FI with eu-energy (Eurostat): this source answers household electricity for FI; eu-energy keeps FI gas and the business sector
  // (declared serves() change in sources/eu-energy, same pattern as SE and NL).
  serves: (p) => p.sector !== "business" && String(p.country ?? "").toUpperCase() === "FI" && String(p.energy ?? "") === "electricity",
  paramNotes: {
    energy: "Finland: electricity only (Statistics Finland's table has no gas); euro per kWh, a national average.",
    consumption_band: `Finland, annual consumption: ${BANDS.map((b) => `${b.code} = ${b.help}`).join("; ")}; default ${DEFAULT_BAND}.`,
    taxes: "Finland: all = with electricity tax and VAT (default); none = energy plus distribution only, calculated by ProofPrice from Statistics Finland's parts.",
  },
  examples: [{ params: { country: "FI", energy: "electricity" } }, { params: { country: "FI", energy: "electricity", consumption_band: "DD", taxes: "none" }, smoke: false }],
  method: fiMethod(),
  harvest: () => fiHarvest(),
  referenceDates: true,
  nominalCounts: true,
  historyKey: (p) => fiHistoryKey({ consumption_band: str(p.consumption_band), taxes: str(p.taxes) }),
  handle: (p, ctx) => fiEnergy({ consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
