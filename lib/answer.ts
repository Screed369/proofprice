// The one answer format every tool returns: a range, the evidence behind it, how sure we are,
// where it came from, and a sentence an AI can quote. Never a bare number.

import { confidenceLabel, MIN_PUBLISH, PriceSummary } from "./stats";
import type { SourceInfo } from "./plugin";

export const METHOD_URL = "/method";

export interface PriceAnswer {
  query: Record<string, unknown>;
  status: "ok" | "insufficient_data" | "no_matches";
  price: null | {
    currency: string;
    unit: string;
    median: number;
    typical_low: number; // 10th percentile
    typical_high: number; // 90th percentile
    min: number;
    max: number;
  };
  sample_size: number;
  period: { from: string | null; to: string | null };
  confidence: "high" | "medium" | "low" | "insufficient";
  price_type: string;
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

const NOTICE = "Information, not a valuation or offer. Ranges describe past recorded prices.";

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
    source: {
      id: src.id,
      name: src.name,
      publisher: src.publisher,
      licence: src.licence,
      licence_url: src.licence_url,
      attribution: src.attribution,
      url: src.homepage,
    },
    method: opts.method,
    method_url: (opts.baseUrl ?? "") + METHOD_URL,
    summary: summaryText,
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
