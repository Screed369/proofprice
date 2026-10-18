// Tool: what hotel rooms cost per night, from official hotel statistics. Sources plug in by declaring category "hotels".
// The tool name pricepaid_hotel_prices is public: never rename it.
// These are NOT booking prices or quotes: statistics offices survey hotels and publish the average price actually charged per occupied room.
import { z } from "zod";
import { defineCategory, str } from "../../lib/plugin";
import { joinOr, freshnessList } from "../../lib/text";

export default defineCategory({
  id: "hotels",
  tool: "pricepaid_hotel_prices",
  restPath: "hotels",
  cacheSeconds: 86400,
  title: "Hotel room prices",
  noun: "Hotel room prices",
  description: (places) =>
    "Use this when a user asks what a hotel room costs per night, on average, in a country, region, province or city in " +
    `${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}, or how hotel prices changed on a year earlier. ` +
    "Returns the official average daily rate: the average price actually charged per occupied hotel room per night, published monthly by the national statistics office from its hotel survey, " +
    "with the month, the change on the same month a year earlier where published, the official source and licence. " +
    "This is a published average over all hotels in the area, not a range of individual bookings and not a quote for a date, so the range fields are null and there is no sample size. " +
    `How fresh: ${freshnessList(places)}. ` +
    "Do not use for the price of one named hotel, a booking for particular dates, holiday rentals or hostels, or for countries that are not listed.",
  params: {
    area: z
      .string()
      .optional()
      .describe("Region, province or city inside the country, in plain words (for example 'Madrid', 'Andalucia', 'Benidorm'). Leave out for the national average."),
    stars: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Hotel star category (1 to 5), for sources that publish it. Only national figures are split by stars; do not combine with area."),
  },
  prepare: (p) => {
    const area = str(p.area);
    const { area: _a, ...rest } = p;
    return { ...rest, ...(area ? { area } : {}) };
  },
});
