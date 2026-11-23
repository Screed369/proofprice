// scripts/library_freshness.py: the count behind the harvest guard and the freshness alarm. Runs the real script on a made-up library.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = "2026-11-24T09:00:00Z";
type Src = { at?: string | null; harvest?: boolean; index?: boolean; brokenMeta?: boolean };

function repo(sources: Record<string, Src>): string {
  const dir = mkdtempSync(join(tmpdir(), "fresh-"));
  mkdirSync(join(dir, "library", "_crosscheck"), { recursive: true });
  writeFileSync(join(dir, "library", "_crosscheck", "meta.json"), "{}"); // never a source
  for (const [id, s] of Object.entries(sources)) {
    mkdirSync(join(dir, "library", id), { recursive: true });
    writeFileSync(join(dir, "library", id, "meta.json"), s.brokenMeta ? "{not json" : JSON.stringify({ source: id, last_harvest_at: s.at ?? null }));
    if (s.index !== false) {
      mkdirSync(join(dir, "sources", id), { recursive: true });
      writeFileSync(join(dir, "sources", id, "index.ts"), s.harvest === false ? "export default defineSource({\n  // No harvest(): blocked host\n  handle,\n});\n" : "export default defineSource({\n  handle,\n  harvest: () => run(),\n});\n");
    }
  }
  return dir;
}
const run = (mode: "guard" | "report", dir: string, ...extra: string[]) =>
  execFileSync("python3", ["-I", "scripts/library_freshness.py", mode, "--dir", dir, "--now", NOW, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const today = "2026-11-24T07:45:00Z";
const yesterday = "2026-11-23T08:10:00Z"; // 24 h 50 min old: fresh, but not today
const old = "2026-11-19T08:00:00Z";

test("guard: one source visited today (a repair run) does NOT make the day count as harvested", () => {
  const dir = repo({ "gb-a": { at: today }, "fr-a": { at: old }, "fr-b": { at: old }, "ie-a": { at: old }, "es-a": { at: old }, "it-a": { at: old }, "de-a": { at: old }, "us-a": { at: old }, "ca-a": { at: old }, "nz-a": { at: old } });
  assert.equal(run("guard", dir), "false");
  const m = JSON.parse(run("guard", dir, "--json"));
  assert.equal(m.total, 10);
  assert.equal(m.visited_today, 1);
  assert.equal(m.done, false);
});

test("guard: true only when at least 90% were visited today (UTC); yesterday's visits do not count", () => {
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`aa-${i}`, { at: today }]));
  assert.equal(run("guard", repo({ ...nine, "zz-a": { at: yesterday } })), "true"); // 9 of 10
  assert.equal(run("guard", repo({ ...nine, "zz-a": { at: yesterday }, "zz-b": { at: yesterday } })), "false"); // 9 of 11
  assert.equal(run("guard", repo({})), "false", "an empty library is never 'done'");
});

test("only sources that can still be harvested are counted: retired folders, no-harvest manifests and _folders are left out", () => {
  const dir = repo({
    "gb-a": { at: today },
    "at-retired": { at: "2026-10-14T00:00:00Z", index: false }, // source folder gone
    "ro-blocked": { at: "2026-11-04T00:00:00Z", harvest: false }, // manifest says "No harvest()" in a comment only
  });
  const m = JSON.parse(run("report", dir, "--json"));
  assert.equal(m.total, 1);
  assert.equal(m.fresh, 1);
  assert.equal(m.alarm, false);
});

test("report: ALARM under 80% within 30 hours, quiet at or above it, and every source is counted", () => {
  const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`aa-${i}`, { at: i % 2 ? today : yesterday }]));
  const ok = run("report", repo({ ...eight, "zz-a": { at: old }, "zz-b": { at: old } })); // 8 of 10 = 80%
  assert.match(ok, /^LIBRARY FRESHNESS: 8 of 10 collected sources/);
  assert.match(ok, /Oldest: zz-a \(121 h\), zz-b \(121 h\)\./);
  const bad = run("report", repo({ ...eight, "zz-a": { at: old }, "zz-b": { at: old }, "zz-c": { at: null } })); // 8 of 11 = 72.7%
  assert.match(bad, /^ALARM LIBRARY FRESHNESS: 8 of 11 collected sources .*\(72\.7%\)/);
  assert.match(bad, /NOT running in full/);
  assert.match(bad, /zz-c \(never\)/);
});

test("report: an unreadable meta.json counts as a stale source, and an empty library is an alarm", () => {
  const m = JSON.parse(run("report", repo({ "gb-a": { at: today }, "gb-b": { brokenMeta: true } }), "--json"));
  assert.equal(m.total, 2);
  assert.equal(m.fresh, 1);
  assert.equal(m.alarm, true);
  assert.match(run("report", repo({})), /^ALARM LIBRARY FRESHNESS: 0 of 0/);
});

test("the real library can be counted and every collected source is in the count", () => {
  const m = JSON.parse(execFileSync("python3", ["-I", "scripts/library_freshness.py", "report", "--json"], { encoding: "utf8" }));
  assert.ok(m.total > 150, `counted ${m.total} sources`);
});
