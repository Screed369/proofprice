// Manifest: United Kingdom BUSINESS (non-domestic) electricity and gas prices (DESNZ Quarterly Energy Prices tables 3.4.1 / 3.4.2). Logic lives in ./source.ts.
// Answers only when sector=business; the UK has no household source in this tool.
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { BANDS, INFO, gbBusinessEnergy } from "./source";

const bandHelp = (e: "electricity" | "gas") => BANDS[e].map((b) => `${b.name} (${b.eu}) = ${b.help}`).join("; ");

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["GB"],
  countryHelp: "With sector=business, GB = United Kingdom (DESNZ: official average prices paid by non-domestic consumers, pence per kWh by size band, quarterly; business only, no household figures)",
  placeName: "the United Kingdom (business)",
  status: "live",
  serves: (p) => p.sector === "business",
  paramNotes: {
    sector: "GB: only sector=business is available (DESNZ non-domestic prices); household prices for GB are not in this tool.",
    energy: "Business GB: electricity or gas, pence per kWh converted to pounds per kWh.",
    consumption_band:
      `Business GB, annual consumption of the business, by DESNZ size band name or by the matching Eurostat letter. Electricity: ${bandHelp("electricity")}. Gas: ${bandHelp("gas")} (no band above Very Large, so Eurostat I6 has no UK figure). ` +
      "Average = all bands together. Default: Small/Medium for electricity (= Eurostat IC) and Medium for gas (= I3).",
    taxes:
      "Business GB: DESNZ prices never include VAT. Default 'excl_vat' = excluding VAT, including the Climate Change Levy (table 3.4.2); 'none' = also excluding the Climate Change Levy (table 3.4.1); 'all' gives the same figure as 'excl_vat' and the answer says so.",
  },
  examples: [
    { params: { country: "GB", sector: "business", energy: "electricity" } },
    { params: { country: "GB", sector: "business", energy: "gas" }, smoke: false },
  ],
  method:
    "United Kingdom business energy: the official average price per kWh that DESNZ publishes every quarter for non-domestic consumers, by size band of annual consumption, excluding VAT and with or without the Climate Change Levy. We pass on the published figure and its quarter; it is an average, not a list of sales.",
  handle: (p, ctx) => {
    if (p.sector !== "business") {
      throw new InputError("Household energy prices are not available for GB in this tool. Use sector=business for UK business prices (DESNZ).");
    }
    return gbBusinessEnergy({ energy: String(p.energy), consumption_band: str(p.consumption_band), taxes: str(p.taxes), baseUrl: ctx.baseUrl });
  },
});
