// Recorded model answers. A result is published only if WE asked the model ourselves and wrote down which model, when, and the exact
// prompt (council ruling 24 Nov 2026). Vendor names need Simon's OK first (Notion "Simon is needed"), so this file is empty until then.
// The page (slice b) only renders what validateResults accepts.

import { QUESTIONS } from "./questions";

export interface RecordedAnswer {
  question_id: string;
  /** The single number the model gave, in the question's currency; null when it gave none. */
  value: number | null;
  /** The model's reply, word for word, so a reader can check how the number was read. */
  reply_text: string;
}

export interface RecordedRun {
  model_id: string;
  model_version: string;
  asked_on: string; // YYYY-MM-DD
  question_set: string;
  /** The exact text sent before each question (empty string if the question was sent alone). */
  prompt_prefix: string;
  asked_by: string;
  answers: RecordedAnswer[];
}

export function validateResults(runs: RecordedRun[], setId: string): string[] {
  const problems: string[] = [];
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const r of runs) {
    const who = `${r.model_id || "(no model)"} ${r.asked_on || "(no date)"}`;
    if (!r.model_id || !r.model_version) problems.push(`${who}: model id and version are required.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.asked_on)) problems.push(`${who}: asked_on must be YYYY-MM-DD.`);
    if (r.question_set !== setId) problems.push(`${who}: answers are for question set ${r.question_set}, not ${setId}.`);
    if (!r.asked_by) problems.push(`${who}: who asked is required.`);
    const seen = new Set<string>();
    for (const a of r.answers) {
      if (!ids.has(a.question_id)) problems.push(`${who}: unknown question ${a.question_id}.`);
      if (seen.has(a.question_id)) problems.push(`${who}: question ${a.question_id} answered twice.`);
      seen.add(a.question_id);
      if (!a.reply_text) problems.push(`${who}: ${a.question_id} has no reply text.`);
    }
    for (const id of ids) if (!seen.has(id)) problems.push(`${who}: question ${id} has no answer; every question is shown, none is dropped.`);
  }
  return problems;
}
