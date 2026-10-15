// Tool: household electricity and gas prices (official statistics). Sources plug in by declaring category "energy".
// The tool name pricepaid_energy_prices is public: never rename it.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

const ENERGY_ALIASES: Record<string, "electricity" | "gas"> = {
  electricity: "electricity", electric: "electricity", power: "electricity",
  gas: "gas", "natural gas": "gas", "mains gas": "gas",
};

const TAX_ALIASES: Record<string, "all" | "excl_vat" | "none"> = {
  all: "all", incl: "all", included: "all",
  excl_vat: "excl_vat", ex_vat: "excl_vat", excluding_vat: "excl_vat",
  none: "none", excl_tax: "none", excl_taxes: "none", no_tax: "none", net: "none",
};

export default defineCategory({
  id: "energy",
  tool: "pricepaid_energy_prices",
  restPath: "energy",
  cacheSeconds: 86400,
  title: "Household electricity and gas prices",
  noun: "Household energy prices",
  description: (places) =>
    "Use this when a user asks what households pay for electricity or natural gas per kWh in " +
    `${joinOr(places.map((p) => p.place))}, how that compares with another country, or how it changed since the previous period. ` +
    "Returns the official average price per kWh for a standard household consumption band, for the latest period published, " +
    "with the same band excluding VAT and excluding all taxes, every band, the previous period and the change, and the official source and licence. " +
    "This is a published average (price_type official_statistic), not a range built from sales, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for business or industrial tariffs, for a specific supplier's offer or a quote for a particular home, for petrol and diesel, or for other countries.",
  params: {
    energy: z.enum(["electricity", "gas"]).describe("electricity or gas (natural gas)."),
    consumption_band: z.string().optional().describe("Standard household consumption band, by letter or by the publisher's code (the country notes list them). Leave out for the standard band."),
    taxes: z.enum(["all", "excl_vat", "none"]).optional().describe("Tax level of the price. 'all' = all taxes and levies included (what a household pays, default); 'excl_vat' = excluding VAT and other recoverable taxes; 'none' = excluding all taxes and levies."),
  },
  required: ["energy"],
  prepare: (p) => {
    const energy = ENERGY_ALIASES[(str(p.energy) ?? "").toLowerCase().replace(/[\s_-]+/g, " ")];
    if (!energy) throw new InputError('energy must be "electricity" or "gas".');
    const rawTaxes = (str(p.taxes) ?? "all").toLowerCase().replace(/[\s-]+/g, "_");
    const taxes = TAX_ALIASES[rawTaxes];
    if (!taxes) throw new InputError('taxes must be "all" (default), "excl_vat" or "none".');
    return { ...p, energy, taxes };
  },
});
