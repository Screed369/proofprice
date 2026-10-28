// Stale-if-error. When a live official source times out or answers with a server error, and the price library holds a
// recent daily snapshot for the same source, area and item, the shared request path (runCategory in lib/registry.ts)
// answers from that snapshot instead of failing with a 502. One implementation for every source: a source qualifies by
// having harvest() and historyKey() (the same two hooks that feed /history), so nothing is written per source.
//
// The answer keeps the one answer format. status is "ok", period and as_of carry the snapshot date, and the notice and
// summary say plainly that the official source did not respond and this is our copy. extra.stale is true so a Monitor or an
// agent can tell it apart from a live answer. A snapshot older than STALE_MAX_DAYS is not "recent" and is never served.

import { fmtMoney, METHOD_URL, NOTICE, sourceBlock, withAudit } from "./answer";
import type { PriceAnswer } from "./answer";
import type { CategoryPlugin, Params, SourcePlugin } from "./plugin";
import { readDaily, readLatestDay, readMeta } from "./library/store";
import { confidenceLabel, hasCount, passesGate, MIN_PUBLISH } from "./stats";

/** A snapshot older than this many days is not recent enough to stand in for a live answer. */
export const STALE_MAX_DAYS = 7;

export interface StaleOptions {
  cat: CategoryPlugin;
  src: SourcePlugin;
  /** The prepared request parameters (country already normalised). */
  params: Params;
  /** The request as echoed in the answer's query. */
  query: Record<string, unknown>;
  /** Why the live source failed (its message is kept in extra.live_source_error; the detail, which may hold a URL, is not). */
  error: unknown;
  baseUrl?: string;
  today?: Date;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Parameters that name a place. A request that names one cannot be answered from a whole-country row. */
const PLACE_PARAMS = ["postcode", "area", "town", "region", "county", "department", "province", "city", "commune", "postcode_district"];

/** The sentence agents and people see, word for word. */
export const staleSentence = (date: string) => `The official source did not respond; this is our copy from ${date}.`;
/** The same for a source whose library rows are dated by the period the figure is for (referenceDates). */
export const staleReferenceSentence = (date: string, collected: string) =>
  `The official source did not respond; this is our copy of the figure for ${date}, collected on ${collected}.`;

/** An answer built from the newest recent library snapshot for this request, or null if there is none to stand in. */
export function staleAnswer(o: StaleOptions): PriceAnswer | null {
  const { cat, src } = o;
  if (!src.harvest || !src.historyKey) return null;
  try {
    const key = src.historyKey(o.params, { stale: true });
    if (!key) return null;
    // The library keys some requests to the whole country ("ALL"). If the caller named a smaller place, a national figure
    // would answer a different question, so keep the honest 502 instead.
    if (key.area === "ALL" && PLACE_PARAMS.some((k) => String(o.params[k] ?? "").trim() !== "")) return null;
    const today = o.today ?? new Date();
    const from = iso(new Date(today.getTime() - STALE_MAX_DAYS * 86400000));
    const usable = (r: { n: number; median: number }) => passesGate(r.n) && Number.isFinite(r.median) && r.median > 0;
    const meta = readMeta(src.info.id);
    let last = readDaily(src.info.id, { area: key.area, item: key.item, from, to: iso(today) }).filter(usable).pop();
    let collected: string | null = null;
    if (!last && src.referenceDates) {
      // Rows are dated by the month or quarter the figure is for. The newest day is still the newest published figure as long
      // as the collector succeeded within the last STALE_MAX_DAYS days.
      const okAt = meta?.last_ok_at ? meta.last_ok_at.slice(0, 10) : null;
      const latest = okAt && okAt >= from && okAt <= iso(today) ? readLatestDay(src.info.id) : null;
      const row = latest?.rows.find((r) => r.area === key.area && r.item === key.item && usable(r));
      if (row) {
        last = row;
        collected = okAt;
      }
    }
    if (!last) return null;
    const currency = meta?.currency;
    const unit = cat.history?.unit?.(key.item) ?? meta?.unit;
    if (!currency || !unit) return null; // never state a price without saying in what currency and per what

    const itemLabel = cat.history?.itemLabel?.(key.item) ?? key.item;
    const money = (v: number) => fmtMoney(v, currency);
    // A published single figure has no count: its confidence is the lowest usable label, not one derived from a made-up number.
    const conf = confidenceLabel(src.nominalCounts || !hasCount(last.n) ? MIN_PUBLISH : last.n);
    const sentence = collected ? staleReferenceSentence(last.date, collected) : staleSentence(last.date);
    const err: any = o.error;
    return withAudit({
      query: o.query,
      status: "ok",
      price: {
        currency,
        unit,
        value: last.median,
        measure: "median",
        median: last.median,
        // a published single figure (nominalCounts) has no range: the library repeats it in low/high/min/max
        typical_low: src.nominalCounts ? null : last.low,
        typical_high: src.nominalCounts ? null : last.high,
        min: src.nominalCounts ? null : last.min,
        max: src.nominalCounts ? null : last.max,
      },
      sample_size: src.nominalCounts || !hasCount(last.n) ? null : last.n, // null for an official statistic, also from older rows that stored the former placeholder
      period: { from: last.date, to: last.date },
      confidence: conf,
      price_type: src.info.price_type,
      as_of: last.date,
      source: sourceBlock(src.info),
      method:
        "Our copy of the official source: once a day ProofPrice stores, for each area and item, the median, 10th–90th percentile and count. " +
        "It is shown because the live source did not respond. The copy covers the area named in the summary.",
      method_url: (o.baseUrl ?? "") + METHOD_URL,
      summary:
        `${itemLabel} in ${key.label}: ` +
        (src.nominalCounts ? `${money(last.median)} ${unit}, ` : `median ${money(last.median)} ${unit} (typical range ${money(last.low)} to ${money(last.high)}), `) +
        `based on ${src.nominalCounts ? "the published figure (no record count is published)" : hasCount(last.n) ? `${last.n} records` : "the published figure"} in our copy of ${src.info.name} (${src.info.publisher}) ${collected ? `for ${last.date}` : `taken on ${last.date}`}. ${sentence} Confidence: ${conf}.`,
      notice: `${sentence} ${NOTICE}`,
      extra: {
        stale: true,
        snapshot_date: last.date,
        snapshot_area: key.label,
        snapshot_item: itemLabel,
        live_source_error: String(err?.message ?? err ?? "unknown").slice(0, 200),
      },
    }, src.info);
  } catch {
    return null; // any trouble reading the library: fall back to the honest 502
  }
}

// ---------- fallback sources ----------
// When a national source cannot be reached and we hold no recent copy of it, another source that declares fallbackFor (for
// example the European Commission's Weekly Oil Bulletin for Italian, French and Spanish pump prices) may answer instead. The
// answer stays that source's own answer: its source block, licence, attribution, price_type and evidence are untouched. Only the
// notice and summary say plainly that it stands in, and extra carries fallback_for and primary_error so an agent or the Monitor
// can tell it apart from the primary source's answer.

/** The sentence agents and people see, word for word. */
export const fallbackSentence = (primaryName: string, fallbackName: string) =>
  `The national source (${primaryName}) could not be reached; this is ${fallbackName}'s national figure instead.`;

/** A short, URL-free reason the primary source failed. */
export function shortError(err: unknown): string {
  const e: any = err;
  return String(e?.message ?? e ?? "unknown").replace(/https?:\/\/\S+/g, "(link)").slice(0, 200);
}

/** Mark an answer from a fallback source as standing in for `primary`. */
export function asFallback(answer: PriceAnswer, primary: SourcePlugin, fallback: SourcePlugin, error: unknown): PriceAnswer {
  const sentence = fallbackSentence(primary.info.publisher, fallback.fallbackFor?.label ?? fallback.info.name);
  return {
    ...answer,
    summary: `${sentence} ${answer.summary}`,
    notice: `${sentence} ${answer.notice}`,
    extra: {
      ...(answer.extra ?? {}),
      fallback_for: primary.info.id,
      primary_error: shortError(error),
    },
  };
}
