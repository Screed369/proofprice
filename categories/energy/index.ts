// Tool: household and business electricity and gas prices (official statistics). Sources plug in by declaring category "energy".
// The tool name pricepaid_energy_prices is public: never rename it. `sector` ("household", the default, or "business") picks
// which prices; business sources are sources/*-energy-business and answer only when sector is "business" (see ./business.ts).
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";
import { BUSINESS_COUNTRIES, normaliseSector } from "./business";

/** Business sources end their placeName with this, so the tool description can list household and business places apart. */
const BUSINESS_PLACE = /\(business\)$/;

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
  noun: "Household and business energy prices",
  description: (places) => {
    const household = places.filter((p) => !BUSINESS_PLACE.test(p.place));
    const business = places.filter((p) => BUSINESS_PLACE.test(p.place));
    return (
      "Use this when a user asks what households pay for electricity or natural gas per kWh in " +
      `${joinOr(household.map((p) => p.place))}, how that compares with another country, or how it changed since the previous period. ` +
      "Returns the official average price per kWh for a standard household consumption band, for the latest period published, " +
      "with the same band excluding VAT and excluding all taxes, every band, the previous period and the change, and the official source and licence. " +
      "This is a published average (price_type official_statistic), not a range built from sales, so the range fields are null and there is no sample size. " +
      `How fresh: ${freshnessList(household)}. ` +
      (business.length
        ? "BUSINESS prices: set sector=business to get what businesses (non-household consumers: shops, offices, factories) pay instead, " +
          `for ${joinOr([...new Set(business.map((p) => p.place.replace(BUSINESS_PLACE, "").trim()))])}. ` +
          "The answer is the official average price paid by businesses in an annual-consumption band (consumption_band; the country notes list the bands), " +
          "excluding VAT unless taxes says otherwise, with the other bands, the previous period and the change. It is an official average, not a quote or a tariff, and " +
          `sector=business needs a country that has business figures. Business freshness: ${freshnessList(business.map((p) => ({ ...p, place: p.place.replace(BUSINESS_PLACE, "").trim() })))}. `
        : "") +
      "Do not use for a specific supplier's offer or a quote for a particular home or company, for wholesale exchange prices (use pricepaid_wholesale_power_prices), for petrol and diesel, or for other countries."
    );
  },
  params: {
    sector: z
      .enum(["household", "business"])
      .optional()
      .describe(
        "Whose price: 'household' (default: what homes pay) or 'business' (non-household consumers: what companies, shops, offices and factories pay; official average by annual-consumption band). " +
          "Leave out for household. Use 'business' whenever the user asks about commercial, industrial, SME, company or non-domestic electricity or gas prices. " +
          "Business figures exist only for the countries listed with 'business' below; for business the default taxes level is 'excl_vat' (businesses reclaim VAT).",
      ),
    energy: z.enum(["electricity", "gas"]).describe("electricity or gas (natural gas)."),
    consumption_band: z.string().optional().describe("Standard consumption band (household bands, or the business bands when sector=business), by letter or by the publisher's code (the country notes list them). Leave out for the standard band."),
    taxes: z.enum(["all", "excl_vat", "none"]).optional().describe("Tax level of the price. 'all' = all taxes and levies included (what a household pays, default); 'excl_vat' = excluding VAT and other recoverable taxes; 'none' = excluding all taxes and levies."),
  },
  required: ["energy"],
  prepare: (p) => {
    const sector = normaliseSector(p.sector);
    if (sector === "business") {
      const country = String(p.country ?? "").trim().toUpperCase();
      if (country && !BUSINESS_COUNTRIES.includes(country)) {
        throw new InputError(
          `Business energy prices (sector=business) are available for ${BUSINESS_COUNTRIES.join(", ")}. Not yet: ${String(p.country)}.`,
        );
      }
    }
    const energy = ENERGY_ALIASES[(str(p.energy) ?? "").toLowerCase().replace(/[\s_-]+/g, " ")];
    if (!energy) throw new InputError('energy must be "electricity" or "gas".');
    const rawTaxes = (str(p.taxes) ?? (sector === "business" ? "excl_vat" : "all")).toLowerCase().replace(/[\s-]+/g, "_");
    const taxes = TAX_ALIASES[rawTaxes];
    if (!taxes) throw new InputError('taxes must be "all" (default), "excl_vat" or "none".');
    // Household requests come out exactly as before (no sector key); business requests carry sector "business" to the business sources.
    return sector === "business" ? { ...p, sector, energy, taxes } : { ...p, energy, taxes };
  },
});
