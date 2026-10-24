// Manifest: Flemish fixed-price energy offers (VREG V-test open data). Answers BE energy requests that carry supplier_offers=true;
// sources/eu-energy keeps answering every other BE request (Eurostat's national average). Declared serves() in both (eu-energy's already routes by request).
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { INFO, beHarvest, beHistoryKey, beMethod, beOffers } from "./source";

const truthy = (v: unknown) => v === true || ["true", "1", "yes"].includes(String(v ?? "").trim().toLowerCase());

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["BE"],
  countryHelp: "BE = Belgium (with supplier_offers=true: Flemish regulator VREG, fixed-price home electricity and gas offers listed in the V-test, monthly; without it: Eurostat's national average)",
  placeName: "Flanders, Belgium (supplier offers)",
  status: "live",
  serves: (p) => truthy(p.supplier_offers) && p.sector !== "business",
  paramNotes: {
    energy: "BE with supplier_offers=true: electricity (single-meter day tariff) or gas; the energy cost per kWh of the fixed-price products suppliers list for homes in Flanders.",
    consumption_band: "BE with supplier_offers=true: not used (offers are priced per kWh, whatever the consumption).",
    taxes: "BE with supplier_offers=true: not used. The offers are always excluding VAT, grid fees, taxes and levies.",
  },
  extraParams: {
    // a boolean or the text "true"/"false": REST sends text, and this source's example is the first of its category in the MCP test
    supplier_offers: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .describe("BE only: true = the fixed-price offers suppliers list for homes in Flanders (regulator VREG, posted offers, energy cost per kWh excluding VAT, grid fees and taxes) instead of Eurostat's national average household price."),
  },
  examples: [
    { params: { country: "BE", energy: "electricity", supplier_offers: "true" } },
    { params: { country: "BE", energy: "gas", supplier_offers: "true" }, smoke: false },
  ],
  method: beMethod(),
  harvest: () => beHarvest(),
  referenceDates: true,
  historyKey: (p) => beHistoryKey({ energy: str(p.energy) }),
  handle: (p, ctx) => beOffers({ energy: str(p.energy), baseUrl: ctx.baseUrl }),
});
