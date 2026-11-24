// The scoring rule, FIXED before any model is asked. A model's answer is compared with our typical range (10th to 90th percentile)
// from official sales records. We never call an answer "correct" or "wrong": only inside, near, far or no answer.
//   inside: the answer lies in the typical range.
//   near:   outside the range but within NEAR_MARGIN of its edge (20% below the low end or above the high end).
//   far:    further out than that.
//   none:   no usable number was given (refusal, a range with no single figure, text that is not a price).
// Small pure functions on purpose, so the rule can be read and tested by anyone.

import { MIN_PUBLISH } from "../stats";

export const NEAR_MARGIN = 0.2;
export type Verdict = "inside" | "near" | "far" | "none";

export interface Truth {
  median: number;
  low: number;
  high: number;
  n: number;
}

export function scoreAnswer(truth: Truth, answer: number | null | undefined): Verdict {
  if (truth.n < MIN_PUBLISH) throw new Error(`Refusing to score against a figure from only ${truth.n} records (minimum ${MIN_PUBLISH}).`);
  if (!(truth.low > 0) || !(truth.high >= truth.low)) throw new Error("Typical range is not valid.");
  if (typeof answer !== "number" || !Number.isFinite(answer) || answer <= 0) return "none";
  if (answer >= truth.low && answer <= truth.high) return "inside";
  if (answer >= truth.low * (1 - NEAR_MARGIN) && answer <= truth.high * (1 + NEAR_MARGIN)) return "near";
  return "far";
}

/** How far the answer is from our median, as a signed percent (+10 means 10% above). Shown beside the verdict. */
export function percentFromMedian(truth: Truth, answer: number): number {
  return Math.round(((answer - truth.median) / truth.median) * 1000) / 10;
}

export interface Tally {
  inside: number;
  near: number;
  far: number;
  none: number;
  total: number;
}

export function tally(verdicts: Verdict[]): Tally {
  const t: Tally = { inside: 0, near: 0, far: 0, none: 0, total: verdicts.length };
  for (const v of verdicts) t[v] += 1;
  return t;
}
