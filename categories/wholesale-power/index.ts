// Tool: wholesale (day-ahead) electricity prices. Sources plug in by declaring category "wholesale-power".
// These are exchange prices per MWh, not what a household pays: the household tariff tool is pricepaid_energy_prices.
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "wholesale-power",
  tool: "pricepaid_wholesale_power_prices",
  restPath: "wholesale-power",
  cacheSeconds: 1800,
  title: "Wholesale (day-ahead) electricity prices",
  noun: "Wholesale electricity prices",
  description: (places) =>
    "Use this when a user asks what electricity costs on the wholesale (day-ahead power exchange) market in " +
    `${joinOr(places.map((p) => p.place))}: the recent median, the typical range across hours, the cheapest and dearest hour, the latest hour and how many hours had negative prices. ` +
    "Prices are in euro per MWh (1 MWh = 1000 kWh; the answer also gives cents per kWh). Built from the hourly auction prices of the recent days, with the official source and licence. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Wholesale prices are not what households or businesses pay on their bills. Do not use for retail tariffs, for petrol and diesel, or for other countries.",
  params: {
    commodity: z.enum(["electricity", "gas"]).optional().describe("electricity (default) or gas. gas returns wholesale natural-gas hub prices where a country has them (see the country notes); prices are per GJ or MWh as the answer states."),
    market: z.enum(["day-ahead"]).optional().describe("Which wholesale market. Only day-ahead (the next-day hourly auction) is available."),
    lookback_days: z.number().int().min(1).max(14).optional().describe("How many recent days of hourly prices to include. Default 7, at most 14."),
  },
  history: {
    tool: "pricepaid_wholesale_power_price_history",
    title: "Wholesale electricity price history",
    description:
      "Use this when a user asks how wholesale electricity prices have changed over recent days or weeks in a country, or whether power is getting cheaper. " +
      "Returns the daily median and typical range of hourly day-ahead prices in euro per MWh, with the change over the period, from our daily snapshots of official data. " +
      "Do not use for household bills.",
    minDays: 7,
    itemLabel: () => "Day-ahead wholesale power",
    unit: () => "per MWh",
  },
});
