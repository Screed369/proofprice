// Manifest: Taiwan natural gas and LPG list prices (CPC Corporation via data.gov.tw). Shares category "energy" with tw-taipower-tariffs
// (electricity): energy=gas or energy=lpg selects this source (serves() here; tw-taipower-tariffs leaves gas/LPG requests to us).
import { defineSource, str } from "../../lib/plugin";
import { INFO, twGas } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["TW"],
  countryHelp: "TW = Taiwan (gas: CPC Corporation's posted list prices for natural gas per m3 and LPG per kg, TWD, before 5% business tax; electricity is answered by Taipower's tariff)",
  placeName: "Taiwan (gas)",
  status: "live",
  paramNotes: {
    energy: "TW: gas = natural gas (TWD per cubic metre), lpg = LPG (TWD per kg); electricity is answered by Taipower's tariff.",
    consumption_band: "TW natural gas: 'household' (default, CPC direct household customers), 'industrial', 'utility', 'cogeneration' or 'power'. Not used for LPG.",
    taxes: "TW gas: not used; prices are before the 5% business tax.",
  },
  examples: [{ params: { country: "TW", energy: "gas" } }, { params: { country: "TW", energy: "lpg" }, smoke: false }],
  method:
    "Taiwan gas: CPC Corporation's published list prices (natural gas per cubic metre by customer type, LPG per kg to dealers), before 5% business tax. Posted list prices, not a count of paid bills.",
  serves: (p) => /\b(gas|lng|lpg|natural|heating|propane)\b/i.test(String(p.energy ?? "")),
  handle: (p, ctx) => twGas({ energy: str(p.energy), consumption_band: str(p.consumption_band), baseUrl: ctx.baseUrl }),
});
