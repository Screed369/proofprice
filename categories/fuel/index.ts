// Tool: live pump prices. Sources plug in by declaring category "fuel" in their manifest.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { FUELS, FUEL_LABEL, normaliseFuel, Fuel } from "../../lib/fuels";
import { InputError } from "../../lib/http";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "fuel",
  tool: "pricepaid_fuel_prices_now",
  restPath: "fuel",
  cacheSeconds: 600,
  title: "Live fuel prices at the pump",
  noun: "Live fuel prices",
  description: (places) =>
    `Use this when a user asks the current price of petrol, diesel, E10, E85, LPG or CNG near a place in ${joinOr(places.map((p) => p.place))}, ` +
    "or where fuel is cheapest there. Returns the median and typical range of pump prices across stations in the area, the three cheapest stations, " +
    `and the official source and licence. How fresh: ${freshnessList(places)}. ` +
    "Do not use for other countries or for historical prices.",
  params: {
    fuel: z.enum(FUELS).describe("petrol95 = unleaded 95; methane = CNG (priced per kg)."),
    postcode: z.string().optional().describe("Postcode of the place."),
    area: z.string().optional().describe("Wider area when no postcode."),
    town: z.string().optional().describe("Town name."),
    service: z.enum(["self", "served"]).optional().describe("Self-service or attended service, where a country prices them differently."),
  },
  required: ["fuel"],
  prepare: (p) => {
    const fuel = normaliseFuel(str(p.fuel) ?? "");
    if (!fuel) throw new InputError(`fuel must be one of: ${FUELS.join(", ")}`);
    return { ...p, fuel };
  },
  // tax=without (price net of duties and taxes) exists only in the EU Weekly Oil Bulletin. Any other source would ignore it and answer with
  // the pump price WITH taxes, which is a different number: say so instead (REST 400 / MCP tool error).
  guard: (src, p, sourceFor, countries) => {
    if (str(p.tax) !== "without" || src.info.id === "eu-oil-bulletin") return;
    const ok = countries.filter((c) => sourceFor(c) === "eu-oil-bulletin");
    throw new InputError(
      `tax=without (the price net of duties and taxes) is only available where the EU Weekly Oil Bulletin answers: ${ok.join(", ")}. ` +
        `${String(p.country)} is answered by ${src.info.id}, which publishes pump prices with taxes only. Leave tax out to get that price.`,
    );
  },
  history: {
    tool: "pricepaid_fuel_price_history",
    title: "Fuel price history",
    description:
      "Use this when a user asks how pump prices have changed over recent days or weeks in a place, or whether fuel is getting cheaper. " +
      "Returns the daily median and typical range of pump prices in the area, with the change over the period, from our daily snapshots of official data. " +
      "Do not use for today's cheapest stations.",
    minDays: 7,
    itemLabel: (item) => {
      const [fuel, served] = item.split("/");
      return (FUEL_LABEL[fuel as Fuel] ?? fuel) + (served ? " (attended service)" : "");
    },
    unit: (item) => (item.startsWith("methane") ? "per kg" : "per litre"),
  },
});
