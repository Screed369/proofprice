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

/** Reliability of an answer, from what it already says. Pure.
 *  A single published figure (an official statistic, or any answer built by buildStatisticAnswer: a list price, a tariff, a
 *  quoted wholesale price, an index) is never "thin": "thin" means a range built from few records. */
export function reliabilityOf(a: Pick<PriceAnswer, "status" | "price" | "sample_size" | "price_type" | "extra"> & { statistic?: PriceAnswer["statistic"] }): Reliability {
  if (a.status !== "ok" || !a.price) return "insufficient_data";
  if (a.extra && (a.extra as any).stale === true) return "stale";
  if (a.price_type === "official_statistic" || a.statistic) return typeof a.sample_size === "number" && a.sample_size > 0 ? "official_with_count" : "official_median_no_count";
  return typeof a.sample_size === "number" && a.sample_size >= 15 ? "record_level" : "thin";
}

/** The newest data date an answer can honestly claim: the end of its period, but never later than the day it is produced.
 *  A period that runs into the future (a calendar year not yet over, a month in progress, a tariff valid until next year, a
 *  weekly price announced for the coming week) gives the publication date when the source passes one, otherwise today. */
export function dataAsOfFor(
  a: { period?: PriceAnswer["period"]; statistic?: PriceAnswer["statistic"] },
  retrievedAt: string = new Date().toISOString(),
  published?: string | null,
): string | null {
  const end = periodEndDate(a.period?.to) ?? periodEndDate(a.period?.from) ?? periodEndDate(a.statistic?.reference_period);
  if (!end) return null;
  const today = retrievedAt.slice(0, 10);
  if (end <= today) return end;
  const pub = periodEndDate(published ?? null);
  return pub && pub <= today ? pub : today;
}

/** Data older than this many years cannot be "high" or "medium" confidence, whatever the sample size. */
export const OLD_DATA_YEARS = 5;

/** Confidence lowered for old data: a figure whose newest data is more than OLD_DATA_YEARS old is at most "low". */
export function ageAdjustedConfidence(conf: PriceAnswer["confidence"], dataAsOf: string | null, now: string = new Date().toISOString()): PriceAnswer["confidence"] {
  if (conf === "insufficient" || conf === "low" || !dataAsOf) return conf;
  const ageDays = (new Date(now).getTime() - new Date(dataAsOf + "T00:00:00Z").getTime()) / 86400000;
  return ageDays > OLD_DATA_YEARS * 365.25 ? "low" : conf;
}

/** Money and other published figures without floating-point leftovers: 2 decimals from 100 up (2503.06005859375 -> 2503.06),
 *  6 significant digits below (per-litre, per-kWh and per-tablet prices are published with 3 to 5 decimals: 1.79469, 0.02792). */
export function roundFigure(v: number): number {
  if (!Number.isFinite(v)) return v;
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Number(v.toPrecision(6));
}

const roundOrNull = (v: number | null | undefined): number | null => (typeof v === "number" ? roundFigure(v) : null);

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
    out.push("This is one published figure (an average, median, index or listed price) with no record count: use it as a reference point, not as a range of what individuals paid.");
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
    label: "Posted or listed price",
    meaning: "A price a seller, market or authority publishes in advance (a shelf price, tariff, fee schedule or quoted wholesale price): it is what is asked, not a record of what each customer paid.",
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

/** Evidence for an index (currency "INDEX"): whatever the price_type, an index value is not a price. */
export const INDEX_EVIDENCE = {
  label: "Official published index",
  meaning: "An index value a statistics office publishes to show how prices move over time or compare between places (against a base of 100): it is not a price anyone paid.",
};

/** The one spelling of the currency of an index value. */
export const INDEX_CURRENCY = "INDEX";

export function evidenceFor(priceType: string, measure?: string, currency?: string): AnswerEvidence {
  if (currency && currency.toUpperCase() === INDEX_CURRENCY) return { type: priceType, ...INDEX_EVIDENCE };
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

export interface AuditOptions {
  /** What the figure really is, when the price_type's general words do not fit (a cheapest posted offer, a median ProofPrice computed). */
  evidence?: { label: string; meaning: string };
  /** ISO date the source published the figure; used for data_as_of when the period runs past today. */
  published?: string | null;
}

/** Add the audit-trail fields to an answer. Central: every builder, and the stale-if-error copy, goes through here.
 *  Only adds fields; nothing that was already in the answer changes. */
export function withAudit<T extends PriceAnswer>(answer: T, src: SourceInfo, retrievedAt: string = new Date().toISOString(), opts: AuditOptions = {}): T {
  const methodVersion = src.method_version ?? "1";
  const base = {
    ...answer,
    answer_id: answerIdFor(src.id, answer.query, answer.period, methodVersion),
    method_version: methodVersion,
    retrieved_at: retrievedAt,
    evidence: opts.evidence ? { type: src.price_type, ...opts.evidence } : evidenceFor(src.price_type, answer.statistic?.measure, answer.price?.currency),
  };
  const reliability = reliabilityOf(base);
  const dataAsOf = dataAsOfFor(answer, retrievedAt, opts.published);
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
  /** ISO date the source published the data; used for data_as_of when the period runs past today (a month in progress). */
  published?: string | null;
  /** What kind of evidence the records are, when the price_type's general words do not fit (e.g. auction final bids). */
  evidence?: { label: string; meaning: string };
}): PriceAnswer {
  const src = opts.source;
  const n = opts.summary?.count ?? 0;
  const retrievedAt = new Date().toISOString();
  const conf = ageAdjustedConfidence(confidenceLabel(n), dataAsOfFor({ period: opts.period }, retrievedAt, opts.published), retrievedAt);
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
          value: roundFigure(opts.summary!.median),
          measure: "median" as const,
          median: roundFigure(opts.summary!.median),
          typical_low: roundFigure(opts.summary!.low),
          typical_high: roundFigure(opts.summary!.high),
          min: roundFigure(opts.summary!.min),
          max: roundFigure(opts.summary!.max),
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
  }, src, retrievedAt, { published: opts.published, evidence: opts.evidence });
}

/** How the summary of a single published figure ends, by default: "Official average published by X for 2025." for an
 *  official statistic, "Official index value published by ..." for an index, and a neutral "Published by X for ..." for a
 *  posted, listed or reimbursement price (which is not an official average). */
export function statisticEnding(src: SourceInfo, measure: "median" | "average", currency: string, referencePeriod: string): string {
  const what =
    currency.toUpperCase() === INDEX_CURRENCY ? "Official index value published" : src.price_type === "official_statistic" ? `Official ${measure} published` : "Published";
  return `${what} by ${src.publisher} for ${referencePeriod}.`;
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
  /** 10th and 90th percentile when the publisher gives them (never a minimum and maximum: use min / max for those). */
  low?: number | null;
  high?: number | null;
  /** Lowest and highest published figure behind the headline (for example the cheapest and dearest variety). */
  min?: number | null;
  max?: number | null;
  method: string;
  describe: (value: number) => string; // plain sentence for a good answer
  note?: string; // optional caveat, e.g. "Provisional figure."
  baseUrl?: string;
  extra?: Record<string, unknown>;
  /** The closing sentence of the summary, when the default (see statisticEnding) does not say what the figure is,
   *  e.g. "Median calculated by ProofPrice from the tariffs ANEEL publishes." */
  ending?: string;
  /** What kind of evidence the figure is, when the price_type's general words do not fit. */
  evidence?: { label: string; meaning: string };
  /** ISO date the source published the figure; used for data_as_of when the period runs past today. */
  published?: string | null;
}): PriceAnswer {
  const src = opts.source;
  const ok = typeof opts.value === "number" && Number.isFinite(opts.value) && opts.value > 0;
  const value = ok ? roundFigure(opts.value as number) : null;
  const retrievedAt = new Date().toISOString();
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
            typical_low: roundOrNull(opts.low),
            typical_high: roundOrNull(opts.high),
            min: roundOrNull(opts.min),
            max: roundOrNull(opts.max),
          }
        : null,
    sample_size: opts.sample_size ?? null,
    period: opts.period,
    confidence: ok ? ageAdjustedConfidence("high", dataAsOfFor({ period: opts.period, statistic }, retrievedAt, opts.published), retrievedAt) : "insufficient",
    price_type: src.price_type,
    statistic,
    as_of: new Date().toISOString(),
    source: sourceBlock(src),
    method: opts.method,
    method_url: (opts.baseUrl ?? "") + METHOD_URL,
    summary:
      value !== null
        ? `${opts.describe(value)} ${opts.ending ?? statisticEnding(src, opts.measure, opts.currency, opts.reference_period)}`
        : `No matching official statistic found in ${src.name} (${src.publisher}) for this query.`,
    notice: NOTICE,
    ...(opts.extra ? { extra: opts.extra } : {}),
  }, src, retrievedAt, { evidence: opts.evidence, published: opts.published });
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
