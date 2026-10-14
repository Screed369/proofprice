// Output schemas: the one answer shape (lib/answer.ts), the history shape and the coverage shape, written once as zod.
// The MCP server advertises them as each tool's outputSchema and validates structuredContent against them;
// openapi.json publishes the same schemas as components. They are deliberately permissive: they require only what every
// answer always has (an answer with status "insufficient_data" or "no_matches" has no price but still has all of this),
// type the fields that may be present, and allow extra properties, so a new source can add to `extra` without breaking
// a client. Tool errors are not answers: they are returned as MCP isError results, which carry no structuredContent.
// This file describes the answer shape; it never changes it (changing the shape needs a Decision).

import { z } from "zod";

const number = z.number();
const nullableNumber = z.number().nullable();

export const sourceBlockSchema = z
  .looseObject({
    id: z.string().describe("Source id, e.g. es-fuel."),
    name: z.string(),
    publisher: z.string().describe("Who publishes the data."),
    licence: z.string(),
    licence_url: z.string(),
    attribution: z.string().describe("The attribution line to show with the figure."),
    url: z.string().describe("The publisher's page for this data."),
  })
  .describe("Where the figure comes from, under which licence, and the attribution line to show.");

const priceSchema = z
  .looseObject({
    currency: z.string().describe("ISO 4217 currency code, e.g. EUR."),
    unit: z.string().describe("What the price is per, e.g. 'per litre', 'per home', 'per kWh'."),
    value: number.describe("The headline figure. For ranges built from records it equals median."),
    measure: z.enum(["median", "average"]).optional().describe("What value is: median for ranges built from records; average or median for official statistics."),
    median: nullableNumber.optional(),
    typical_low: nullableNumber.optional().describe("10th percentile; null for official statistics that give no range."),
    typical_high: nullableNumber.optional().describe("90th percentile; null for official statistics that give no range."),
    min: nullableNumber.optional(),
    max: nullableNumber.optional(),
  })
  .describe("The price. Null when there is not enough data to publish a figure (fewer than 5 records) or nothing matched.");

export const priceAnswerSchema = z
  .looseObject({
    query: z.record(z.string(), z.unknown()).describe("The request as understood, echoed back."),
    status: z.enum(["ok", "insufficient_data", "no_matches"]).describe("ok = a figure is returned; insufficient_data = fewer than 5 matching records; no_matches = nothing matched."),
    price: priceSchema.nullable().optional(),
    sample_size: nullableNumber.optional().describe("Number of records behind the figure; null when the publisher does not say."),
    period: z
      .looseObject({ from: z.string().nullable(), to: z.string().nullable() })
      .optional()
      .describe("The period the records cover (ISO dates), or the date of the snapshot when the answer comes from our copy."),
    confidence: z.enum(["high", "medium", "low", "insufficient"]).optional().describe("high = 50+ records, medium = 15–49, low = 5–14."),
    price_type: z.string().optional().describe("transaction, posted_pump_price, posted_price, contract_price, reimbursement_price or official_statistic."),
    statistic: z
      .looseObject({ measure: z.enum(["median", "average"]), reference_period: z.string(), note: z.string().optional() })
      .optional()
      .describe("Official statistics only: what kind of figure it is and the period the publisher states it for."),
    as_of: z.string().optional().describe("When the answer was produced (ISO 8601); the snapshot date when the official source was down and the answer comes from our copy."),
    source: sourceBlockSchema,
    method: z.string().optional(),
    method_url: z.string().optional(),
    summary: z.string().describe("One plain sentence an AI can quote."),
    notice: z.string().describe("Information, not a valuation or offer. Also says when the answer is our copy because the official source did not respond."),
    extra: z.record(z.string(), z.unknown()).optional().describe("Source-specific details (for example cheapest stations). extra.stale is true when the answer comes from our copy of the source."),
    answer_id: z.string().optional().describe("Audit trail: a stable id (hash of source id, normalised query, data period and method_version). The same question on the same data gives the same id; keep it with the reasoning that used the figure."),
    method_version: z.string().optional().describe("Audit trail: version of the way this source turns raw data into an answer (per source, default '1')."),
    retrieved_at: z.string().optional().describe("Audit trail: when ProofPrice produced this answer (ISO 8601). For an answer from our own copy this is now, while as_of is the snapshot date."),
    evidence: z
      .looseObject({
        type: z.string().describe("Same as price_type."),
        label: z.string().describe("Short name of the kind of evidence, e.g. 'Recorded sale prices', 'Official published average', 'Posted shelf or pump price', 'Contract award value', 'Regulated reimbursement price'."),
        meaning: z.string().describe("One sentence on what this kind of evidence does and does not establish."),
      })
      .optional()
      .describe("Audit trail: what kind of evidence the figure is."),
  })
  .describe("A price answer: a range or an official statistic with sample size, period, confidence, source and licence.");

const verdictEnum = z.enum([
  "within_typical_range",
  "above_typical_range",
  "below_typical_range",
  "about_average",
  "above_average",
  "below_average",
  "cannot_judge",
]);

export const checkResultSchema = z
  .looseObject({
    verdict: verdictEnum.describe(
      "within/above/below_typical_range: the price compared with the 10th–90th percentile of recorded prices. about_average/above_average/below_average: compared with one published official average or median (within ±5% = about_average). cannot_judge: the evidence cannot honestly be compared (see reasons and missing).",
    ),
    summary: z.string().describe("One plain sentence an AI can quote."),
    position: z
      .looseObject({
        basis: z.enum(["range", "average"]).describe("range = records with a 10th–90th percentile; average = one published official figure, not a distribution."),
        text: z.string().describe("Where the price sits, e.g. '27% above the median and above the 90th percentile'."),
        vs_median_percent: nullableNumber.optional().describe("Percent difference from the median (range basis) or from the published figure (average basis); positive = above."),
        vs_typical_low_percent: nullableNumber.optional(),
        vs_typical_high_percent: nullableNumber.optional(),
        reference_value: number.describe("The median or published average the price is compared with."),
        typical_low: nullableNumber.optional(),
        typical_high: nullableNumber.optional(),
      })
      .nullable()
      .describe("Where the price sits against the evidence; null when cannot_judge."),
    reasons: z.array(z.string()).describe("Why this verdict, including cautions (posted versus paid prices, old periods, assumptions made)."),
    missing: z.array(z.string()).describe("What stopped or limits the comparison (currency or unit mismatch, too few records, nothing matched). Empty when nothing is missing."),
    input: z
      .looseObject({
        category: z.string(),
        country: z.string(),
        price: number,
        currency: z.string().nullable(),
        unit: z.string().nullable(),
        includes: z.string().nullable(),
      })
      .describe("The price check as understood, echoed back. currency and unit are null when not given (the evidence currency and unit were assumed)."),
    answer: priceAnswerSchema.describe("The full evidence answer (the same answer the category tool returns), embedded so the reasoning can be kept with its source, licence and audit-trail fields."),
    notice: z.string(),
  })
  .describe("A price check: a verdict on a proposed price against recorded evidence, where it sits, why, what is missing, and the full evidence answer. Deterministic: no benchmark is ever invented.");

export const historyAnswerSchema = z
  .looseObject({
    query: z.record(z.string(), z.unknown()),
    status: z.enum(["ok", "insufficient_history", "no_history_yet"]),
    currency: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    series: z.array(
      z.looseObject({
        date: z.string(),
        median: number,
        typical_low: number,
        typical_high: number,
        sample_size: number,
      }),
    ),
    period: z.looseObject({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
    change: z
      .looseObject({ from_median: number, to_median: number, absolute: number, percent: number })
      .nullable()
      .optional()
      .describe("Change over the period; null with fewer than two days."),
    price_type: z.string().optional(),
    source: sourceBlockSchema,
    library: z
      .looseObject({
        first_date: z.string().nullable(),
        last_date: z.string().nullable(),
        days_collected: number,
        days_since_last_snapshot: nullableNumber,
      })
      .optional(),
    method: z.string().optional(),
    method_url: z.string().optional(),
    summary: z.string(),
    notice: z.string(),
  })
  .describe("A daily series from the ProofPrice price library: date, median, typical range and sample size, with the change over the period.");

export const coverageSchema = z
  .looseObject({
    service: z.string(),
    purpose: z.string().optional(),
    tools: z.array(z.looseObject({ name: z.string(), rest: z.string(), countries: z.array(z.string()) })),
    sources: z.array(z.looseObject({ id: z.string(), name: z.string(), publisher: z.string(), licence: z.string() })),
    examples: z.array(z.string()).optional(),
    rules: z.array(z.string()).optional(),
    coming_next: z.array(z.string()).optional(),
  })
  .describe("Which tools, countries and official sources are covered, with each source's licence and update frequency.");

export const errorSchema = z
  .looseObject({ error: z.string().describe("What went wrong, in plain words."), detail: z.unknown().optional() })
  .describe("An error: a missing or invalid parameter (400) or an official source that could not be reached (502).");

/** zod writes "extra properties allowed" as additionalProperties: {}; say it as plainly as JSON Schema can (true). */
function openExtras(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(openExtras);
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.additionalProperties && typeof o.additionalProperties === "object" && Object.keys(o.additionalProperties).length === 0) o.additionalProperties = true;
  Object.values(o).forEach(openExtras);
}

/** JSON Schema (draft 2020-12, as OpenAPI 3.1 uses) of one of the schemas above, with its description kept. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s: any = z.toJSONSchema(schema, { unrepresentable: "any", io: "output" });
  delete s.$schema;
  openExtras(s);
  return s;
}
