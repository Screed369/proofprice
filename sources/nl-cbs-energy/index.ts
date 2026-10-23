// Manifest: Netherlands household electricity and gas prices by consumption class, half-yearly (Statistics Netherlands CBS table 85666NED). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { BANDS, DEFAULT_BAND, INFO, nlEnergy, nlMethod } from "./source";

const help = (e: "electricity" | "gas") => BANDS[e].map((b) => `${b.code} = ${b.help}`).join("; ");

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["NL"],
  countryHelp: "NL = Netherlands (Statistics Netherlands CBS: average household electricity price in euro per kWh and gas price in euro per m3 by consumption class, half-yearly, official statistic)",
  placeName: "the Netherlands",
  status: "live",
  // Shares NL with eu-energy (Eurostat): this source answers NL household electricity and gas; eu-energy keeps the other countries and business goes to eu-energy-business
  // (declared serves() change in sources/eu-energy, Gap fix G20261023-PLATFORM-SERVES-ENERGY-RENT).
  serves: (p) => p.sector !== "business" && String(p.country ?? "").toUpperCase() === "NL",
  paramNotes: {
    energy: "Netherlands: electricity (euro per kWh) and gas (euro per m3, with a calculated euro per kWh in extra); national averages.",
    consumption_band: `Netherlands, annual consumption. Electricity: ${help("electricity")}; default ${DEFAULT_BAND.electricity}. Gas: ${help("gas")}; default ${DEFAULT_BAND.gas}.`,
    taxes: "Netherlands: all = CBS's price with VAT and taxes (default); excl_vat = without VAT, taxes in; none = without VAT and taxes. All three are published by CBS.",
  },
  examples: [{ params: { country: "NL", energy: "electricity" } }, { params: { country: "NL", energy: "gas", consumption_band: "D2" }, smoke: false }],
  method: nlMethod(),
  handle: (p, ctx) => nlEnergy({ energy: str(p.energy), consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl }),
});
