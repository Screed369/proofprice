// Manifest: Singapore piped town gas tariffs (City Energy via SingStat on data.gov.sg). Shares category "energy" with sg-sp-tariff
// (electricity): energy=gas selects this source (serves() here; sg-sp-tariff has none and so stays the default for electricity).
import { defineSource, str } from "../../lib/plugin";
import { INFO, sgGas } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["SG"],
  countryHelp: "SG = Singapore (piped town gas only: City Energy's published annual tariff, SGD per kWh excluding GST, a posted tariff)",
  placeName: "Singapore (gas)",
  status: "live",
  paramNotes: {
    energy: "SG: gas = piped town gas tariff; electricity is answered by SP Group's tariff.",
    consumption_band: "SG gas: general (default), bulk_a or bulk_b (the publisher's three tariffs).",
    taxes: "SG: not used; the figure excludes GST.",
  },
  examples: [{ params: { country: "SG", energy: "gas" } }],
  method:
    "Singapore piped town gas: City Energy's published tariff (cents per kWh excluding GST), latest calendar year, converted to dollars. A posted tariff, not a count of paid bills.",
  serves: (p) => String(p.energy ?? "").toLowerCase().includes("gas"),
  handle: (p, ctx) => sgGas({ energy: str(p.energy), consumption_band: str(p.consumption_band), baseUrl: ctx.baseUrl }),
});
