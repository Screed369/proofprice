// Manifest: household electricity and gas prices for the EU, Norway and Iceland (Eurostat). Logic lives in ./source.ts.
import { defineSource, str } from "../../lib/plugin";
import { COUNTRIES, DATASETS, INFO, euEnergy } from "./source";

const bandHelp = (e: "electricity" | "gas") => DATASETS[e].bands.map((b) => `${b.letter} = ${b.help}`).join("; ");

export default defineSource({
  info: INFO,
  category: "energy",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "EU member states plus NO and IS, as ISO codes (GR for Greece): " + Object.entries(COUNTRIES).map(([c, n]) => `${c} = ${n}`).join(", "),
  placeName: "the EU, Norway and Iceland",
  status: "live",
  // business requests go to eu-energy-business (same countries, other source); SE household electricity goes to se-scb-energy
  // (Statistics Sweden, declared serves() change, Gap fix G20261023-PLATFORM-SERVES-ENERGY-RENT); NL household electricity and gas go to nl-cbs-energy (CBS, same Gap fix); FI household electricity goes to fi-stat-energy (Statistics Finland table 13rb, declared serves() change, Builder C 23 Oct); NO household electricity goes to no-ssb-electricity (SSB table 14491) once that folder exists, declared serves() change by the Repairer 31 Oct (platform task from Builders B and D). Until then the request falls back to this source.
  serves: (p) =>
    p.sector !== "business" &&
    String(p.country ?? "").toUpperCase() !== "NL" &&
    !(["SE", "FI", "NO"].includes(String(p.country ?? "").toUpperCase()) && String(p.energy ?? "") === "electricity"),
  paramNotes: {
    energy: "EU/NO/IS: Eurostat currently has no recent household gas price for CY, FI, IS, MT or NO (status no_matches).",
    consumption_band:
      `EU/NO/IS, annual consumption. Electricity: ${bandHelp("electricity")}; default DC. ` +
      `Gas: ${bandHelp("gas")}; default D2. ALL = all bands together. Eurostat codes such as KWH2500-4999 or GJ20-199 also work.`,
  },
  examples: [
    { params: { country: "IE", energy: "electricity" } },
    { params: { country: "DE", energy: "gas" }, smoke: false },
  ],
  method:
    "EU, Norway and Iceland energy: the official average household price per kWh that Eurostat publishes every half-year, for a standard consumption band and tax level. We pass on the published figure and its reference period; it is an average, not a list of sales.",
  handle: (p, ctx) =>
    euEnergy({
      country: String(p.country),
      energy: String(p.energy),
      consumption_band: str(p.consumption_band),
      taxes: str(p.taxes),
      baseUrl: ctx.baseUrl,
    }),
});
