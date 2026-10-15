// The one answer format every tool returns: a range, the evidence behind it, how sure we are,
// where it came from, and a sentence an AI can quote. Never a bare number.
//
// Two builders fill it:
//  - buildAnswer: a range built from records we hold (median, 10th-90th percentile, sample size).
//  - buildStatisticAnswer: an official statistic (an average or median that a statistics office or regulator
//    publishes). We pass on the published figure with its reference period and source; the range fields are null.

import { createHash } from "node:crypto";
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
  // ----- audit trail (additive, optional: added by withAudit, so every answer carries them) -----
  /** Stable id of this answer: a hash of the source id, the normalised query, the data period and the method version. The same question on the same data gives the same id, so a buyer can keep it as a receipt for the reasoning. */
  answer_id?: string;
  /** Version of the way this source turns raw data into an answer (per source, default "1"). */
  method_version?: string;
  /** When ProofPrice produced this answer (ISO 8601). For an answer from our own copy this is now, while as_of is the snapshot date. */
  retrieved_at?: string;
  /** What kind of evidence the figure is, in words. */
  evidence?: AnswerEvidence;
  // ----- reliability (additive, optional: added by withAudit, so every answer carries them) -----
  /** How far the figure can be trusted as a distribution of real prices. Independent of `confidence`, which stays as it was for backwards compatibility. */
  reliability?: Reliability;
  /** ISO date (YYYY-MM-DD) of the newest data point behind the figure; null when the source does not say. */
  data_as_of?: string | null;
  /** Whole days between data_as_of and retrieved_at; null when data_as_of is null. */
  data_age_days?: number | null;
  /** Short, plain things to try next (widen the period or area, ask for an itemised quote). May be empty. */
  suggestions?: string[];
}

export type Reliability = "official_with_count" | "official_median_no_count" | "record_level" | "thin" | "stale" | "insufficient_data";
export const RELIABILITY_VALUES = ["official_with_count", "official_median_no_count", "record_level", "thin", "stale", "insufficient_data"] as const;

/** The last day of the period a text names: 2025-09-30, 2025-09, 2025-Q3, 2025-S2, 2025 or null. */
export function periodEndDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = String(text).trim();
  const full = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ym = t.match(/^(\d{4})-(\d{2})\b/);
  if (ym && +ym[2] >= 1 && +ym[2] <= 12) return iso(+ym[1], +ym[2], lastDay(+ym[1], +ym[2]));
  const q = t.match(/^(\d{4})[-\s]?Q([1-4])$/i);
  if (q) return iso(+q[1], +q[2] * 3, lastDay(+q[1], +q[2] * 3));
  const h = t.match(/^(\d{4})[-\s]?(?:S|H)([12])$/i);
  if (h) return iso(+h[1], +h[2] * 6, lastDay(+h[1], +h[2] * 6));
  const y = t.match(/^(\d{4})$/);
  if (y) return iso(+y[1], 12, 31);
  return null;
}

/** Reliability of an answer, from what it already says. Pure. */
export function reliabilityOf(a: Pick<PriceAnswer, "status" | "price" | "sample_size" | "price_type" | "extra">): Reliability {
  if (a.status !== "ok" || !a.price) return "insufficient_data";
  if (a.extra && (a.extra as any).stale === true) return "stale";
  if (a.price_type === "official_statistic") return typeof a.sample_size === "number" && a.sample_size > 0 ? "official_with_count" : "official_median_no_count";
  return typeof a.sample_size === "number" && a.sample_size >= 15 ? "record_level" : "thin";
}

function suggestionsFor(a: PriceAnswer, rel: Reliability, ageDays: number | null): string[] {
  const out: string[] = [];
  const q = a.query ?? {};
  const hasPlace = ["area", "postcode", "town", "region", "county", "city", "department", "province"].some((k) => String((q as any)[k] ?? "").trim() !== "");
  if (rel === "insufficient_data") {
    out.push(a.status === "no_matches" ? "Nothing matched: check the spelling or try a broader item." : "Fewer than 5 records matched: widen the area or the period.");
    if (hasPlace) out.push("Try a larger area (a whole region or the country).");
    out.push("Call the coverage tool to see which countries, items and sources are available.");
  } else if (rel === "thin") {
    out.push("Few records stand behind this range: widen the period or the area for a steadier figure.");
    out.push("Treat it as a rough guide and ask for an itemised quote before deciding.");
  } else if (rel === "official_median_no_count") {
    out.push("This is one published average or median with no record count: use it as a reference point, not as a range of what individuals paid.");
    out.push("For a decision on a specific job or purchase, ask for an itemised quote.");
  } else if (rel === "official_with_count") {
    out.push("This is one published figure for a group: for a specific job or purchase, ask for an itemised quote.");
  } else if (rel === "stale") {
    out.push("The official source did not respond and this is our copy: retry later for the live figure.");
  }
  if (rel !== "stale" && ageDays !== null && ageDays > 365) out.push("The newest data is over a year old: prices may have moved, so check for a more recent source.");
  if (a.price_type === "posted_pump_price" || a.price_type === "posted_price") out.push("This is a posted price, not what each customer paid.");
  return out;
}

export interface AnswerEvidence {
  /** Same as price_type. */
  type: string;
  /** Short name of the kind of evidence, e.g. "Recorded sale prices". */
  label: string;
  /** One sentence on what this kind of evidence does and does not establish. */
  meaning: string;
}

/** What each kind of price is, and what it does and does not establish. One place, used by every answer. */
export const EVIDENCE_KINDS: Record<string, { label: string; meaning: string }> = {
  transaction: {
    label: "Recorded sale prices",
    meaning: "Prices recorded in official records of completed sales: they show what others paid, not what a particular item is worth or what is on offer now.",
  },
  official_statistic: {
    label: "Official published average",
    meaning: "One average or median that a statistics office or regulator publishes for a reference period: it describes a group, not a distribution, and says nothing about any single price.",
  },
  posted_pump_price: {
    label: "Posted shelf or pump price",
    meaning: "The price a seller displays (for example at a pump or on a shelf): it is what is asked at the time, not a record of what each customer paid.",
  },
  posted_price: {
    label: "Posted shelf or pump price",
    meaning: "The price a seller displays (for example at a pump or on a shelf): it is what is asked at the time, not a record of what each customer paid.",
  },
  contract_price: {
    label: "Contract award value",
    meaning: "The value of a contract awarded under public procurement rules: it shows what a buyer agreed to pay for that contract, not a price list for the same goods or services.",
  },
  reimbursement_price: {
    label: "Regulated reimbursement price",
    meaning: "A price set or reimbursed by a regulator or health system: it is what that scheme pays, not necessarily what a consumer pays in a shop.",
  },
};

export function evidenceFor(priceType: string, measure?: string): AnswerEvidence {
  const k = EVIDENCE_KINDS[priceType] ?? {
    label: "Published price",
    meaning: "A price published by the official source: check price_type and the method before relying on it.",
  };
  const label = priceType === "official_statistic" && measure === "median" ? "Official published median" : k.label;
  return { type: priceType, label, meaning: k.meaning };
}

/** The query in a fixed form, so the same question always gives the same answer_id: keys sorted, text trimmed, lower-cased and
 *  with inner spaces collapsed, empty values dropped. */
export function normaliseQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(query).sort()) {
    const v = query[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const t = v.trim().replace(/\s+/g, " ").toLowerCase();
      if (t) out[k] = t;
    } else out[k] = v;
  }
  return out;
}

export function answerIdFor(sourceId: string, query: Record<string, unknown>, period: { from: string | null; to: string | null }, methodVersion: string): string {
  const basis = JSON.stringify([sourceId, normaliseQuery(query), period.from ?? null, period.to ?? null, methodVersion]);
  return "ans_" + createHash("sha256").update(basis).digest("hex").slice(0, 20);
}

/** Add the audit-trail fields to an answer. Central: every builder, and the stale-if-error copy, goes through here.
 *  Only adds fields; nothing that was already in the answer changes. */
export function withAudit<T extends PriceAnswer>(answer: T, src: SourceInfo, retrievedAt: string = new Date().toISOString()): T {
  const methodVersion = src.method_version ?? "1";
  const base = {
    ...answer,
    answer_id: answerIdFor(src.id, answer.query, answer.period, methodVersion),
    method_version: methodVersion,
    retrieved_at: retrievedAt,
    evidence: evidenceFor(src.price_type, answer.statistic?.measure),
  };
  const reliability = reliabilityOf(base);
  const dataAsOf = periodEndDate(answer.period?.to) ?? periodEndDate(answer.period?.from) ?? periodEndDate(answer.statistic?.reference_period);
  const ageMs = dataAsOf ? new Date(retrievedAt).getTime() - new Date(dataAsOf + "T00:00:00Z").getTime() : NaN;
  const dataAge = Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 86400000)) : null;
  return { ...base, reliability, data_as_of: dataAsOf, data_age_days: dataAge, suggestions: suggestionsFor(base, reliability, dataAge) };
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

  return withAudit({
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
  }, src);
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
  return withAudit({
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
  }, src);
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
