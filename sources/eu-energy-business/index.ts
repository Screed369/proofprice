// Manifest: BUSINESS (non-household) electricity and gas prices for the EU, EFTA and candidate countries (Eurostat). Logic lives in ./source.ts.
// Answers only when sector=business; household requests for these countries go to sources/eu-energy.
import { defineSource, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { COUNTRIES, DATASETS, INFO, euBusinessEnergy } from "./source";

const bandHelp = (e: "electricity" | "gas") => DATASETS[e].bands.map((b) => `${b.letter} = ${b.help}`).join("; ");

export default defineSource({
  info: INFO,
  category: "energy",
  countries: Object.keys(COUNTRIES),
  countryHelp:
    "With sector=business, official average prices paid by businesses (Eurostat) for the EU member states, NO, IS and the EU candidate countries, as ISO codes (GR for Greece): " +
    Object.keys(COUNTRIES).join(", "),
  placeName: "the EU, Norway, Iceland and EU candidate countries (business)",
  status: "live",
  serves: (p) => p.sector === "business",
  paramNotes: {
    sector: "EU/NO/IS/candidate countries (Eurostat nrg_pc_205 and nrg_pc_203): sector=business is available; household prices come from the household source.",
    energy:
      "Business, EU/NO/IS/candidates: Eurostat's latest half-year may be missing for some countries or bands (status no_matches); try another band.",
    consumption_band:
      `Business, EU/NO/IS/candidates, annual consumption of the business. Electricity: ${bandHelp("electricity")}; default IC (Eurostat's reference band for medium-sized business consumers). ` +
      `Gas: ${bandHelp("gas")}; default I3. Gas has no all-bands total; ALL works for electricity only. Eurostat codes such as MWH500-1999 or GJ10000-99999 also work. ` +
      "A small shop or office is typically IA or IB (electricity) and I1 (gas); a factory IC to IE.",
    taxes:
      "Business, EU/NO/IS/candidates: default 'excl_vat' (excluding VAT and other recoverable taxes and levies: what a business really bears); 'all' = all taxes and levies including VAT; 'none' = excluding all taxes and levies.",
  },
  examples: [
    { params: { country: "IE", sector: "business", energy: "electricity" } },
    { params: { country: "DE", sector: "business", energy: "gas" }, smoke: false },
  ],
  method:
    "EU, EFTA and candidate countries, business energy: the official average price per kWh that Eurostat publishes every half-year for non-household consumers, for an annual-consumption band and tax level. We pass on the published figure and its reference period; it is an average, not a list of sales.",
  handle: (p, ctx) => {
    if (p.sector !== "business") {
      throw new InputError(`Household energy prices are not available for ${String(p.country)} yet. Use sector=business for business prices.`);
    }
    return euBusinessEnergy({
      country: String(p.country),
      energy: String(p.energy),
      consumption_band: str(p.consumption_band),
      taxes: str(p.taxes),
      baseUrl: ctx.baseUrl,
    });
  },
});
