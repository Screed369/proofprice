// Tool: rents people actually agreed or paid. Sources plug in by declaring category "rent".
// The tool name pricepaid_rent_prices is public: never rename it.
// Rents here are always paid or agreed rents (registered tenancies, rental bonds, approved rentals, or surveys of
// sitting tenants), never the asking rents of listings.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { InputError } from "../../lib/http";
import { joinOr } from "../../lib/text";

const TYPE_ALIASES: Record<string, "any" | "apartment" | "house" | "room"> = {
  any: "any", all: "any",
  apartment: "apartment", apartments: "apartment", flat: "apartment", flats: "apartment", unit: "apartment", condo: "apartment",
  house: "house", houses: "house", home: "house",
  room: "room", rooms: "room", "room only": "room",
};

export default defineCategory({
  id: "rent",
  tool: "pricepaid_rent_prices",
  restPath: "rent",
  cacheSeconds: 86400,
  title: "Rents paid",
  noun: "Rents paid",
  description: (places) =>
    "Use this when a user asks what rent tenants actually pay or have agreed for a home in a town, area or postcode, how much it costs to rent a flat, house or room there, " +
    `or how rents compare, in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "These are rents actually agreed or paid, taken from official records: registered tenancies, rental bond lodgements, approved rentals, or official surveys of sitting tenants. " +
    "Where the source holds individual rents the answer is a median with a typical range (10th–90th percentile) and the number of rents; " +
    "where the source publishes an average or median (price_type official_statistic) the range fields are null and there is no sample size. " +
    "Every answer states its unit (rent per month or per week, in the local currency), the period covered, a confidence label, and the official source and licence. " +
    `How fresh: ${[...new Set(places.map((p) => p.freshness.charAt(0).toLowerCase() + p.freshness.slice(1)))].join("; ")}. ` +
    "Do not use for asking rents or listings, holiday lets, commercial rent, rent for a specific address, home prices (use the home sales tool), or other countries.",
  params: {
    town: z.string().min(2).optional().describe("Town, city or local area."),
    postcode: z.string().optional().describe("Postcode, for a precise area."),
    property_type: z.enum(["any", "apartment", "flat", "house", "room"]).optional().describe("Kind of home: apartment (same as flat), house or room. Default 'any'."),
    bedrooms: z.number().int().min(0).max(10).optional().describe("Number of bedrooms (0 = studio). Leave out for all sizes."),
    months: z.number().int().min(1).max(36).optional().describe("How many recent months to include, for sources that hold individual rents. Ignored by sources that publish one figure per quarter or month."),
  },
  prepare: (p) => {
    const out = { ...p };
    const raw = str(p.property_type);
    if (raw !== undefined) {
      const t = TYPE_ALIASES[raw.toLowerCase().replace(/[\s_-]+/g, " ")];
      if (!t) throw new InputError('property_type must be "apartment" (or "flat"), "house", "room" or "any".');
      out.property_type = t;
    }
    if (p.bedrooms !== undefined && p.bedrooms !== null && p.bedrooms !== "") {
      const b = Number(p.bedrooms);
      if (!Number.isInteger(b) || b < 0 || b > 10) throw new InputError("bedrooms must be a whole number from 0 (studio) to 10.");
      out.bedrooms = b;
    }
    return out;
  },
});
