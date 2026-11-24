// Writes the frozen answer key for the scoreboard: our typical range for every question, copied from the price library.
// Run once when a NEW question set is made, then commit the JSON. Never re-run to "refresh" a set that has results.
// Usage: tsx scripts/scoreboard-freeze.ts <frozen-on YYYY-MM-DD>
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readDaily } from "../lib/library/store";
import { QUESTIONS, QUESTION_SET_ID } from "../lib/scoreboard/questions";
import { buildSnapshot, type RowIn } from "../lib/scoreboard/snapshot";
import { INFO as IE } from "../sources/ie-ppr/source";
import { INFO as GB } from "../sources/gb-hmlr-ppd/source";

const frozenOn = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(frozenOn ?? "")) throw new Error("Give the freeze date as YYYY-MM-DD.");
const out = path.join(process.cwd(), "lib", "scoreboard", `snapshot-${QUESTION_SET_ID}.json`);
if (existsSync(out)) throw new Error(`${out} already exists: a frozen key is never rewritten. Make a new dated set instead.`);

const facts = {
  "ie-ppr": { licence: IE.licence, attribution: IE.attribution },
  "gb-hmlr-ppd": { licence: GB.licence, attribution: GB.attribution },
};
const rowsBySource: Record<string, RowIn[]> = {};
for (const q of QUESTIONS) {
  rowsBySource[q.source] ??= [];
  rowsBySource[q.source].push(...(readDaily(q.source, { area: q.area, item: q.item, from: "2026-01-01", to: frozenOn }) as RowIn[]));
}
const snap = buildSnapshot(QUESTION_SET_ID, frozenOn, QUESTIONS, rowsBySource, facts);
writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
console.log(`Wrote ${out} with ${snap.entries.length} entries.`);
