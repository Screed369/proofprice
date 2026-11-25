import test from "node:test";
import assert from "node:assert/strict";
import snapshot from "../lib/scoreboard/snapshot-2026-11-24.json";
import results from "../lib/scoreboard/results.json";
import { QUESTIONS, QUESTION_SET_ID } from "../lib/scoreboard/questions";
import { scoreAnswer, percentFromMedian, tally, NEAR_MARGIN } from "../lib/scoreboard/score";
import { pickEntry } from "../lib/scoreboard/snapshot";
import { validateResults, type RecordedRun } from "../lib/scoreboard/results";
import { METHOD_STEPS, LIMITS } from "../lib/scoreboard/method";
import { MIN_PUBLISH } from "../lib/stats";

const truth = { median: 100, low: 80, high: 130, n: 50 };

test("scoring: inside, near, far, none", () => {
  assert.equal(scoreAnswer(truth, 80), "inside");
  assert.equal(scoreAnswer(truth, 130), "inside");
  assert.equal(scoreAnswer(truth, 64), "near"); // 80 * 0.8
  assert.equal(scoreAnswer(truth, 156), "near"); // 130 * 1.2
  assert.equal(scoreAnswer(truth, 63.9), "far");
  assert.equal(scoreAnswer(truth, 156.1), "far");
  assert.equal(scoreAnswer(truth, null), "none");
  assert.equal(scoreAnswer(truth, 0), "none");
  assert.equal(scoreAnswer(truth, Number.NaN), "none");
  assert.equal(NEAR_MARGIN, 0.2);
});

test("scoring refuses a key built from fewer than 5 records", () => {
  assert.throws(() => scoreAnswer({ ...truth, n: MIN_PUBLISH - 1 }, 100), /fewer|only/i);
  assert.doesNotThrow(() => scoreAnswer({ ...truth, n: MIN_PUBLISH }, 100));
});

test("percent from median and tally", () => {
  assert.equal(percentFromMedian(truth, 110), 10);
  assert.equal(percentFromMedian(truth, 90), -10);
  assert.deepEqual(tally(["inside", "far", "inside", "none"]), { inside: 2, near: 0, far: 1, none: 1, total: 4 });
});

test("question set: unique ids, plain prompts, no banned words", () => {
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length);
  const banned = /\b(fair|guaranteed|verified price|correct price)\b/i;
  for (const q of QUESTIONS) {
    assert.ok(q.prompt.endsWith("."), q.id);
    assert.doesNotMatch(q.prompt + q.unit_note, banned, q.id);
  }
});

test("frozen snapshot matches the question set one to one and every figure rests on 5 or more records", () => {
  assert.equal(snapshot.question_set, QUESTION_SET_ID);
  assert.deepEqual(snapshot.entries.map((e) => e.question_id), QUESTIONS.map((q) => q.id));
  for (const e of snapshot.entries) {
    const q = QUESTIONS.find((x) => x.id === e.question_id)!;
    assert.equal(e.source, q.source);
    assert.equal(e.area, q.area);
    assert.equal(e.item, q.item);
    assert.ok(e.n >= MIN_PUBLISH, e.question_id);
    assert.ok(e.low <= e.median && e.median <= e.high, e.question_id);
    assert.match(e.data_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.data_date <= snapshot.frozen_on, "a figure cannot be dated after the day it was frozen");
    assert.ok(e.licence.length > 5 && e.attribution.length > 5, `${e.question_id} must carry licence and attribution`);
  }
});

test("pickEntry takes the newest row and throws on thin or missing data", () => {
  const q = QUESTIONS[0];
  const facts = { licence: "L", attribution: "A" };
  const row = (date: string, n: number) => ({ date, area: q.area, item: q.item, n, median: 10, low: 5, high: 20 });
  assert.equal(pickEntry(q, [row("2026-11-01", 9), row("2026-11-13", 50)], facts).data_date, "2026-11-13");
  assert.throws(() => pickEntry(q, [row("2026-11-13", 4)], facts), /minimum/);
  assert.throws(() => pickEntry(q, [], facts), /No library row/);
  assert.throws(() => pickEntry(q, [{ ...row("2026-11-13", Number.NaN) }], facts), /minimum/);
});

test("recorded results: the file ships empty, and a run must be complete to be accepted", () => {
  assert.deepEqual(results.runs, []);
  assert.deepEqual(validateResults(results.runs as RecordedRun[], QUESTION_SET_ID), []);
  const good: RecordedRun = {
    model_id: "m", model_version: "1", asked_on: "2026-11-25", question_set: QUESTION_SET_ID, prompt_prefix: "", asked_by: "ProofPrice",
    answers: QUESTIONS.map((q) => ({ question_id: q.id, value: 1, reply_text: "x" })),
  };
  assert.deepEqual(validateResults([good], QUESTION_SET_ID), []);
  const dropped = { ...good, answers: good.answers.slice(1) };
  assert.match(validateResults([dropped], QUESTION_SET_ID).join(" "), /no answer/);
  assert.match(validateResults([{ ...good, asked_on: "yesterday" }], QUESTION_SET_ID).join(" "), /YYYY-MM-DD/);
  assert.match(validateResults([{ ...good, question_set: "2020-01-01" }], QUESTION_SET_ID).join(" "), /question set/);
});

test("method text says typical, never fair or guaranteed", () => {
  const text = [...METHOD_STEPS, ...LIMITS].join(" ");
  assert.doesNotMatch(text, /\b(fair|guaranteed|verified price)\b/i);
  assert.match(text, /typical/);
});

import { buildScoreboardView } from "../lib/scoreboard/view";
import type { Snapshot } from "../lib/scoreboard/snapshot";

test("view: every question gets its frozen key and an empty results file says so plainly", () => {
  const v = buildScoreboardView(snapshot as Snapshot, []);
  assert.equal(v.questions.length, QUESTIONS.length);
  assert.ok(v.questions.every((q) => q.key.n >= MIN_PUBLISH));
  assert.equal(v.runs.length, 0);
  assert.match(v.no_results_note ?? "", /No assistant has been measured yet/);
});

test("view: a recorded run is scored against the frozen range, and a partial run is refused", () => {
  const answers = QUESTIONS.map((q, i) => ({ question_id: q.id, value: i === 0 ? null : (snapshot as Snapshot).entries[i].median, reply_text: "x" }));
  const run: RecordedRun = { model_id: "m", model_version: "1", asked_on: "2026-11-25", question_set: QUESTION_SET_ID, prompt_prefix: "", asked_by: "us", answers };
  const v = buildScoreboardView(snapshot as Snapshot, [run]);
  assert.equal(v.runs[0].tally.none, 1);
  assert.equal(v.runs[0].tally.inside, QUESTIONS.length - 1);
  assert.equal(v.no_results_note, null);
  assert.throws(() => buildScoreboardView(snapshot as Snapshot, [{ ...run, answers: answers.slice(1) }]), /not valid/);
});
