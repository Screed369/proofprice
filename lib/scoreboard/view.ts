// What the /scoreboard page shows, built from the three frozen files (questions, snapshot, recorded runs).
// Pure on purpose: rows in, rows out, so the page itself holds no logic and the numbers can be tested.
// Every question is listed, with our typical range, record count, data date and licence. A model column exists only for runs we recorded.

import { QUESTIONS, type ScoreboardQuestion } from "./questions";
import { scoreAnswer, percentFromMedian, tally, type Tally, type Verdict } from "./score";
import { validateResults, type RecordedRun } from "./results";
import type { Snapshot, SnapshotEntry } from "./snapshot";

export interface QuestionRow {
  question: ScoreboardQuestion;
  key: SnapshotEntry;
}

export interface RunRow {
  run: RecordedRun;
  tally: Tally;
  answers: { question_id: string; value: number | null; verdict: Verdict; percent_from_median: number | null; reply_text: string }[];
}

export interface ScoreboardView {
  question_set: string;
  frozen_on: string;
  questions: QuestionRow[];
  runs: RunRow[];
  /** Plain statement shown at the top while no model has been recorded. */
  no_results_note: string | null;
}

/** Joins questions with the frozen key. Throws if a question has no key or the recorded runs fail validation: a broken page never ships. */
export function buildScoreboardView(snapshot: Snapshot, runs: RecordedRun[], questions: ScoreboardQuestion[] = QUESTIONS): ScoreboardView {
  const byId = new Map(snapshot.entries.map((e) => [e.question_id, e]));
  const rows: QuestionRow[] = questions.map((q) => {
    const key = byId.get(q.id);
    if (!key) throw new Error(`Question ${q.id} has no entry in the frozen snapshot.`);
    return { question: q, key };
  });
  const problems = validateResults(runs, snapshot.question_set);
  if (problems.length) throw new Error(`Recorded results are not valid: ${problems.join(" | ")}`);
  const runRows: RunRow[] = runs.map((run) => {
    const answers = run.answers.map((a) => {
      const key = byId.get(a.question_id)!;
      const verdict = scoreAnswer(key, a.value);
      return {
        question_id: a.question_id,
        value: a.value,
        verdict,
        percent_from_median: typeof a.value === "number" && a.value > 0 ? percentFromMedian(key, a.value) : null,
        reply_text: a.reply_text,
      };
    });
    return { run, answers, tally: tally(answers.map((a) => a.verdict)) };
  });
  return {
    question_set: snapshot.question_set,
    frozen_on: snapshot.frozen_on,
    questions: rows,
    runs: runRows,
    no_results_note: runRows.length === 0 ? "No assistant has been measured yet. We publish a result only when we have asked the assistant ourselves and recorded its full reply." : null,
  };
}
