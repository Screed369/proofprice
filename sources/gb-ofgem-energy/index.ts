// Manifest: Great Britain household energy price cap by region and payment method (Ofgem). Logic lives in ./source.ts.
import { z } from "zod";
import { defineSource, str } from "../../lib/plugin";
import { AVERAGE, INFO, REGIONS, gbEnergy, gbMethod } from "./source";

export default defineSource({
  info: INFO,
  category: "energy",
  countries: ["GB"],
  countryHelp: "GB = Great Britain (Ofgem energy price cap: maximum unit rate in pence per kWh and daily standing charge for default tariffs, by region and payment method, quarterly, a regulated posted price)",
  placeName: "Great Britain",
  status: "live",
  // GB has no household source of its own in this category (gb-desnz-energy-business answers sector=business only), so no serves() is needed.
  serves: (p) => p.sector !== "business",
  paramNotes: {
    energy: "GB: electricity (single-rate) and gas, in GBP per kWh with the standing charge in extra. The Ofgem cap is a regulated maximum on default tariffs, not a price paid.",
    consumption_band: "GB: not used (the cap is a unit rate and a standing charge, not a price by consumption band).",
    taxes: "GB: not used. Gas figures include 5% VAT; electricity has no VAT from 1 October 2026 to 31 March 2027 (Ofgem's own wording).",
  },
  extraParams: {
    gb_region: z
      .string()
      .optional()
      .describe(
        `GB only: Ofgem region (${REGIONS.join(", ")}) or a well-known town such as Manchester, Glasgow, Cardiff or London. Leave out for the ${AVERAGE}.`,
      ),
    payment_method: z
      .string()
      .optional()
      .describe("GB only: direct_debit (default), standard_credit (pay on receipt of the bill) or prepayment (prepayment meter)."),
  },
  examples: [
    { params: { country: "GB", energy: "electricity" } },
    { params: { country: "GB", energy: "gas", gb_region: "London", payment_method: "direct_debit" }, smoke: false },
  ],
  method: gbMethod(),
  handle: (p, ctx) => gbEnergy({ energy: str(p.energy), region: str(p.gb_region), payment_method: str(p.payment_method), baseUrl: ctx.baseUrl }),
});
