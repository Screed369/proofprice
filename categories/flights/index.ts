// Tool: average airfares actually paid on domestic routes (official statistics). Sources plug in by declaring category "flights".
// The tool name pricepaid_airfare_prices is public: never rename it.
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "flights",
  tool: "pricepaid_airfare_prices",
  restPath: "airfares",
  cacheSeconds: 86400,
  title: "Airfares paid",
  noun: "Airfares paid",
  description: (places) =>
    "Use this when a user asks what people actually pay for a flight between two cities or airports (for example JFK to LAX, or Chicago to Miami), " +
    `or what the average airfare out of a city is, in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. ` +
    "Returns the official average fare per passenger each way, in the currency the answer states, for the latest quarter published, with (where the source publishes them) the passengers per day behind it, " +
    "the share of the largest carrier, the change on a year earlier and the last few quarters, plus the official source and licence. " +
    "This is a published quarterly average of fares paid (price_type official_statistic), not a range built from tickets, so the range fields are null and there is no sample size; " +
    `how fresh: ${freshnessList(places)}. ` +
    "Do not use for today's fare, a specific date, airline or cabin, a booking or price alert, international flights, routes outside the places named above, hotels, or other countries.",
  params: {
    from: z.string().min(2).describe("Where the flight starts: an airport code (JFK, LAX) or a city (Chicago, 'Portland, OR'). Required."),
    to: z.string().min(2).optional().describe("Where it ends: an airport code or a city. Leave out to get the average fare over the busiest routes out of the 'from' city."),
    quarters: z.number().int().min(1).max(20).optional().describe("How many recent quarters to include in the trend (default 4, at most 20). The headline figure is always the latest quarter."),
  },
  required: ["from"],
});
