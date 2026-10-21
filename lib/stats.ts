// Small, dependency-free statistics helpers used by every price answer.

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface PriceSummary {
  count: number;
  median: number;
  low: number; // 10th percentile
  high: number; // 90th percentile
  min: number;
  max: number;
}

export function summarise(values: number[]): PriceSummary | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return {
    count: clean.length,
    median: round(percentile(clean, 0.5)),
    low: round(percentile(clean, 0.1)),
    high: round(percentile(clean, 0.9)),
    min: round(clean[0]),
    max: round(clean[clean.length - 1]),
  };
}

function round(v: number): number {
  return v >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000;
}

// Confidence label from sample size. Below MIN_PUBLISH we refuse to give a figure.
export const MIN_PUBLISH = 5;

/** The `n` of a library row whose publisher gives one figure and no record count (an official statistic). It is NaN, never a made-up
 *  number: the library stores it as an empty cell, history and answers return sample_size null, and `n >= x` is false for it, so
 *  record-level code can never mistake it for a count. Use `hasCount(n)` to tell. */
export const NO_COUNT = Number.NaN;
export const hasCount = (n: number): boolean => Number.isFinite(n);
/** The library gate for one row: a real record count must reach MIN_PUBLISH; NO_COUNT (an official statistic) passes because there is
 *  no sample to be thin. Only sources that publish a single figure write NO_COUNT. */
export const passesGate = (n: number): boolean => Number.isNaN(n) || n >= MIN_PUBLISH;

export function confidenceLabel(n: number): "high" | "medium" | "low" | "insufficient" {
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  if (n >= MIN_PUBLISH) return "low";
  return "insufficient";
}
