// The one answer format every tool returns: a range, the evidence behind it, how sure we are,
// where it came from, and a sentence an AI can quote. Never a bare number.
//
// Two builders fill it:
//  - buildAnswer: a range built from records we hold (median, 10th-90th percentile, sample size).
//  - buildStatisticAnswer: an official statistic (an average or median that a statistics office or regulator
//    publishes). We pass on the published figure with its reference period and source; the range fields are null.

import { confidenceLabel, MIN_PUBLISH, PriceSummary } from "./stats";
import type { SourceInfo } from "./plugin";

export const METHOD_URL = "/method";

export interface PriceAnswer {
  query: Record<string, unknown>;
  status: "ok" | "insufficient_data" | "no_matches";
  price: null | {
    currency: string;
    unit: string;
    /** The headline figure. For ranges built from records it equals `median`. */
    value: number;
    /** What `value` is: "median" for ranges built from records; "average" or "median" for official statistics. */
    measure: "median" | "average";
    /** Null for an official average (the publisher gives one figure, not a distribution). */
    median: number | null;
    typical_low: number | null; // 10th percentile; null for official statistics that give no range
    typical_high: number | null; // 90th percentile; null for official statistics that give no range
    min: number | null;
    max: number | null;
  };
  /** Number of records behind the figure; null when the publisher does not say. */
  sample_size: number | null;
  period: { from: string | null; to: string | null };
  confidence: "high" | "medium" | "low" | "insufficient";
  price_type: string;
  /** Only for official statistics: what kind of figure it is and the period the publisher states it for. */
  statistic?: { measure: "median" | "average"; reference_period: string; note?: string };
  as_of: string;
  source: {
    id: string;
    name: string;
    publisher: string;
    licence: string;
    licence_url: string;
    attribution: string;
    url: string;
  };
  method: string;
  method_url: string;
  summary: string;
  notice: string;
  extra?: Record<string, unknown>;
}

export const NOTICE = "Information, not a valuation or offer. Ranges describe past recorded prices.";

export function sourceBlock(src: SourceInfo): PriceAnswer["source"] {
  return {
    id: src.id,
    name: src.name,
    publisher: src.publisher,
    licence: src.licence,
    licence_url: src.licence_url,
    attribution: src.attribution,
    url: src.homepage,
  };
}

export function buildAnswer(opts: {
  source: SourceInfo;
  query: Record<string, unknown>;
  summary: PriceSummary | null;
  currency: string;
  unit: string;
  period: { from: string | null; to: string | null };
  method: string;
  describe: (s: PriceSummary) => string; // plain sentence for a good answer
  baseUrl?: string;
  extra?: Record<string, unknown>;
}): PriceAnswer {
  const src = opts.source;
  const n = opts.summary?.count ?? 0;
  const conf = confidenceLabel(n);
  const enough = opts.summary && n >= MIN_PUBLISH;
  const status: PriceAnswer["status"] = n === 0 ? "no_matches" : enough ? "ok" : "insufficient_data";
  const summaryText = enough
    ? `${opts.describe(opts.summary!)} Based on ${n} records from ${src.publisher}` +
      (opts.period.from ? ` (${opts.period.from} to ${opts.period.to})` : "") +
      `. Confidence: ${conf}.`
    : n === 0
      ? `No matching records found in ${src.name} (${src.publisher}) for this query.`
      : `Only ${n} matching record(s) in ${src.name}; at least ${MIN_PUBLISH} are needed before we publish a range.`;

  return {
    query: opts.query,
    status,
    price: enough
      ? {
          currency: opts.currency,
          unit: opts.unit,
          value: opts.summary!.median,
          measure: "median" as const,
          median: opts.summary!.median,
          typical_low: opts.summary!.low,
          typical_high: opts.summary!.high,
          min: opts.summary!.min,
          max: opts.summary!.max,
        }
      : null,
    sample_size: n,
    period: opts.period,
    confidence: conf,
    price_type: src.price_type,
    as_of: new Date().toISOString(),
    source: sourceBlock(src),
    method: opts.method,
    method_url: (opts.baseUrl ?? "") + METHOD_URL,
    summary: summaryText,
    notice: NOTICE,
    ...(opts.extra ? { extra: opts.extra } : {}),
  };
}

/**
 * An official statistic: one average (or median) that a statistics office or regulator publishes for a stated reference
 * period. We pass the published figure on unchanged. There is no range to compute, so median, typical_low, typical_high,
 * min and max are null unless the publisher gives them (`low` / `high` fill typical_low / typical_high), and
 * sample_size is null unless the publisher says how many records stand behind the figure.
 * Status is "ok" when value is a finite number above zero, otherwise "no_matches".
 */
export function buildStatisticAnswer(opts: {
  source: SourceInfo;
  query: Record<string, unknown>;
  value: number | null;
  measure: "median" | "average";
  currency: string;
  unit: string;
  period: { from: string | null; to: string | null };
  reference_period: string; // the period the publisher states the figure for, e.g. "2025-S2"
  sample_size?: number | null;
  low?: number | null;
  high?: number | null;
  method: string;
  describe: (value: number) => string; // plain sentence for a good answer
  note?: string; // optional caveat, e.g. "Provisional figure."
  baseUrl?: string;
  extra?: Record<string, unknown>;
}): PriceAnswer {
  const src = opts.source;
  const ok = typeof opts.value === "number" && Number.isFinite(opts.value) && opts.value > 0;
  const value = ok ? (opts.value as number) : null;
  const statistic: NonNullable<PriceAnswer["statistic"]> = { measure: opts.measure, reference_period: opts.reference_period };
  if (opts.note) statistic.note = opts.note;
  return {
    query: opts.query,
    status: ok ? "ok" : "no_matches",
    price:
      value !== null
        ? {
            currency: opts.currency,
            unit: opts.unit,
            value,
            measure: opts.measure,
            median: opts.measure === "median" ? value : null,
            typical_low: opts.low ?? null,
            typical_high: opts.high ?? null,
            min: null,
            max: null,
          }
        : null,
    sample_size: opts.sample_size ?? null,
    period: opts.period,
    confidence: ok ? "high" : "insufficient",
    price_type: src.price_type,
    statistic,
    as_of: new Date().toISOString(),
    source: sourceBlock(src),
    method: opts.method,
    method_url: (opts.baseUrl ?? "") + METHOD_URL,
    summary:
      value !== null
        ? `${opts.describe(value)} Official ${opts.measure} published by ${src.publisher} for ${opts.reference_period}.`
        : `No matching official statistic found in ${src.name} (${src.publisher}) for this query.`,
    notice: NOTICE,
    ...(opts.extra ? { extra: opts.extra } : {}),
  };
}

export function fmtMoney(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: v >= 100 ? 0 : 3,
    }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}
