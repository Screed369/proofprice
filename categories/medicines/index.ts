// Tool: official regulated prices of medicines sold in pharmacies. Sources plug in by declaring category "medicines".
import { z } from "zod";
import { defineCategory } from "../../lib/plugin";
import { joinOr } from "../../lib/text";

export default defineCategory({
  id: "medicines",
  tool: "pricepaid_medicine_prices",
  restPath: "medicines",
  cacheSeconds: 86400,
  title: "Official pharmacy prices of medicines",
  noun: "Medicine prices",
  description: (places) =>
    "Use this when a user asks what a medicine costs in a pharmacy, or how much of the price the health insurance reimburses, " +
    `in ${joinOr(places.map((p) => `${p.place} (country ${p.code})`))}. Returns the median and typical range (10th–90th percentile) of the legally fixed ` +
    "price per box across all pack sizes and strengths sold under that medicine name, the number of packs, the period, a confidence label, and the official source and licence. " +
    "These are regulated (posted) prices, not market transactions, and only for reimbursable medicines. Do not use for over-the-counter products with free prices or for other countries.",
  params: {
    medicine: z.string().describe("Medicine brand or active-substance name, e.g. 'doliprane' or 'paracetamol'. Only the first word is used."),
  },
  required: ["medicine"],
});
