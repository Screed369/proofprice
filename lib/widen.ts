// Widening a thin local answer to the national figure, honestly. When fewer than MIN_PUBLISH stations sell a fuel in a
// department or province (LPG, E85 and methane are sold at a few stations), the local range cannot be published. Instead of
// "insufficient_data" the source may answer with its own national library row for the same fuel, labelled as national.
// The row comes from the price library (the collector's newest day, at most WIDEN_MAX_DAYS old), so no extra live call is made.
import { readDaily } from "./library/store";
import { passesGate } from "./stats";
import type { PriceSummary } from "./stats";

export const WIDEN_MAX_DAYS = 3;

export interface NationalRow {
  date: string;
  summary: PriceSummary;
}

/** The newest recent national ("ALL") library row for an item, or null when none passes the 5-record gate. */
export function nationalRow(sourceId: string, item: string, today: Date = new Date(), area = "ALL"): NationalRow | null {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(new Date(today.getTime() - WIDEN_MAX_DAYS * 86400000));
  const r = readDaily(sourceId, { area, item, from, to: iso(today) })
    .filter((x) => passesGate(x.n) && Number.isFinite(x.median) && x.median > 0)
    .pop();
  if (!r) return null;
  return { date: r.date, summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max } };
}

/** The sentence agents see, word for word. */
export const widenSentence = (fuelLabel: string, placeLabel: string, whole: string, n: number) =>
  `Fewer than 5 stations sell ${fuelLabel} in ${placeLabel}, so no local range is published. This is the figure for ${whole} instead (${n} stations).`;
