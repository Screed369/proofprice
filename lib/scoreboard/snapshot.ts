// The frozen answer key. A snapshot is our own typical range for every question, copied from the price library on one day and
// never recomputed: the library moves daily, a recorded model answer must be compared with the figures that stood when it was asked.
// buildSnapshot is pure (rows in, snapshot out); scripts/scoreboard-freeze.ts reads the library and writes the JSON file.

import { MIN_PUBLISH, hasCount } from "../stats";
import type { ScoreboardQuestion } from "./questions";

export interface SnapshotEntry {
  question_id: string;
  source: string;
  area: string;
  item: string;
  currency: string;
  median: number;
  low: number;
  high: number;
  n: number;
  /** The library day the figure is dated (the publisher's own data date), not the day we froze it. */
  data_date: string;
  licence: string;
  attribution: string;
}

export interface Snapshot {
  question_set: string;
  frozen_on: string;
  entries: SnapshotEntry[];
}

export interface RowIn {
  date: string;
  area: string;
  item: string;
  n: number;
  median: number;
  low: number;
  high: number;
}

export interface SourceFacts {
  licence: string;
  attribution: string;
}

/** Newest row for the question's key. Throws, never guesses, if the figure is missing or rests on fewer than 5 records. */
export function pickEntry(q: ScoreboardQuestion, rows: RowIn[], facts: SourceFacts): SnapshotEntry {
  const mine = rows.filter((r) => r.area === q.area && r.item === q.item).sort((a, b) => (a.date < b.date ? 1 : -1));
  const r = mine[0];
  if (!r) throw new Error(`No library row for ${q.id} (${q.source} ${q.area} ${q.item}).`);
  if (!hasCount(r.n) || r.n < MIN_PUBLISH) throw new Error(`${q.id}: only ${r.n} records, minimum is ${MIN_PUBLISH}.`);
  for (const v of [r.median, r.low, r.high]) if (!Number.isFinite(v) || v <= 0) throw new Error(`${q.id}: bad figure in the library row.`);
  return {
    question_id: q.id, source: q.source, area: q.area, item: q.item, currency: q.currency,
    median: r.median, low: r.low, high: r.high, n: r.n, data_date: r.date,
    licence: facts.licence, attribution: facts.attribution,
  };
}

export function buildSnapshot(setId: string, frozenOn: string, questions: ScoreboardQuestion[], rowsBySource: Record<string, RowIn[]>, facts: Record<string, SourceFacts>): Snapshot {
  return {
    question_set: setId,
    frozen_on: frozenOn,
    entries: questions.map((q) => pickEntry(q, rowsBySource[q.source] ?? [], facts[q.source] ?? (() => { throw new Error(`No licence facts for ${q.source}`); })())),
  };
}
