// The MCP tool list is read in full by an AI before it asks anything, so every character in it costs the caller context.
// This file keeps that list small without changing what any tool accepts or returns:
//  - slimOutputSchema: the advertised outputSchema is a short sketch (the fields an agent reads first); the full schemas in
//    lib/schemas.ts stay the source for openapi.json. Answers are unchanged and still validated (loosely) against the sketch.
//  - slimShape: the same input validators with shorter descriptions. Long per-country notes stay available through
//    pricepaid_coverage (and the REST openapi.json), which is where an agent goes for detail.
// tests/tool-list-size.test.ts keeps the total under budget.

import { z } from "zod";
import type { ZodTypeAny } from "zod";

const num = z.number();

/** Short sketches of the four output shapes. Loose: extra fields pass; only the fields every answer has are required. */
export const slimAnswerSchema = z
  .looseObject({
    status: z.enum(["ok", "insufficient_data", "no_matches"]),
    summary: z.string().describe("One sentence an AI can quote."),
    price: z.looseObject({ currency: z.string(), unit: z.string(), value: num, typical_low: num.nullable().optional(), typical_high: num.nullable().optional() }).nullable().optional(),
    sample_size: num.nullable().optional(),
    period: z.looseObject({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
    confidence: z.string().optional().describe("high, medium, low or insufficient."),
    source: z.looseObject({ name: z.string(), licence: z.string(), attribution: z.string() }).optional(),
  })
  .describe("Price range from real records: price, sample_size, period, confidence, source and licence.");

export const slimHistorySchema = z
  .looseObject({
    status: z.enum(["ok", "insufficient_history", "no_history_yet"]),
    summary: z.string(),
    series: z.array(z.looseObject({ date: z.string(), median: num })),
    change: z.looseObject({ percent: num }).nullable().optional(),
    source: z.looseObject({ name: z.string() }).optional(),
  })
  .describe("Daily series: date, median, typical range, sample size, change over the period.");

export const slimCheckSchema = z
  .looseObject({
    verdict: z.enum(["within_typical_range", "above_typical_range", "below_typical_range", "about_average", "above_average", "below_average", "cannot_judge"]),
    summary: z.string(),
    reasons: z.array(z.string()),
    missing: z.array(z.string()),
    answer: z.looseObject({}).optional().describe("The full evidence answer, as the category tool returns it."),
  })
  .describe("Verdict on a proposed price against recorded evidence.");

export const slimCoverageSchema = z
  .looseObject({
    summary: z.string(),
    tools: z.array(z.looseObject({ name: z.string(), category: z.string(), countries: z.array(z.string()) })),
    sources: z.array(z.looseObject({ id: z.string(), name: z.string(), licence: z.string() })).optional(),
  })
  .describe("Tools, countries and official sources covered; full per-source detail for a category and/or country.");

/** A description cut at a word boundary, ending with an ellipsis, never longer than max. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(" "));
  return `${cut.slice(0, at > max * 0.5 ? at : max - 1).replace(/[ ;,.]+$/, "")}…`;
}

/** Repeated sentences (the same note added by several sources) once only. */
function dedupe(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/(?<=[.;])\s+/)
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
    .join(" ");
}

const COUNTRY_MAX = 260;
const PARAM_MAX = 240;

/** The same validators with shorter descriptions (see top of file). */
export function slimShape(shape: Record<string, ZodTypeAny>): Record<string, ZodTypeAny> {
  const out: Record<string, ZodTypeAny> = {};
  for (const [name, schema] of Object.entries(shape)) {
    const d = schema.description;
    if (!d) {
      out[name] = schema;
      continue;
    }
    const max = name === "country" ? COUNTRY_MAX : PARAM_MAX;
    out[name] = d.length <= max ? schema : schema.describe(clip(dedupe(d), max));
  }
  return out;
}
