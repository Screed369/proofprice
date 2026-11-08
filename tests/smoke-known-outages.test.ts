// Tests for the known-outage list logic in scripts/smoke.py (matching + expiry). Runs the real Python functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DRIVER = `
import importlib.util, json, sys, datetime
spec = importlib.util.spec_from_file_location("smoke", "scripts/smoke.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
file, today, probe = sys.argv[1], datetime.date.fromisoformat(sys.argv[2]), sys.argv[3]
active, problems = m.load_known_outages(file, today)
hit = m.match_known_outage(probe, active)
print(json.dumps({"hit": hit["path"] if hit else None, "problems": problems, "n": len(active)}))
`;

function run(entries: unknown, today: string, probe: string) {
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  const file = join(dir, "k.json");
  writeFileSync(file, JSON.stringify({ outages: entries }));
  return JSON.parse(execFileSync("python3", ["-I", "-c", DRIVER, file, today, probe], { encoding: "utf8" }));
}
const e = (over = {}) => ({ path: "/api/v1/farm-prices?country=IE", reason: "portal down", since: "2026-11-08", expires: "2026-11-22", ...over });

test("an unexpired entry excuses a matching example (exact and prefix)", () => {
  assert.equal(run([e()], "2026-11-10", "/api/v1/farm-prices?country=IE&product=pig").hit, "/api/v1/farm-prices?country=IE");
  assert.equal(run([e({ path: "/api/v1/farm-prices?country=IE&product=pig" })], "2026-11-22", "/api/v1/farm-prices?country=IE&product=pig").n, 1);
});
test("a non-matching example is not excused", () => {
  const r = run([e()], "2026-11-10", "/api/v1/farm-prices?country=AT&product=rapeseed");
  assert.equal(r.hit, null);
});
test("an expired entry no longer excuses anything and is reported", () => {
  const r = run([e()], "2026-11-23", "/api/v1/farm-prices?country=IE&product=pig");
  assert.equal(r.hit, null);
  assert.match(r.problems[0], /EXPIRED/);
});
test("an entry longer than 14 days is rejected", () => {
  const r = run([e({ expires: "2026-11-23" })], "2026-11-10", "/api/v1/farm-prices?country=IE&product=pig");
  assert.equal(r.hit, null);
  assert.match(r.problems[0], /within 14 days/);
});
test("malformed entries and entries not yet active are ignored", () => {
  assert.equal(run([{ path: "/x" }], "2026-11-10", "/x").hit, null);
  assert.equal(run([e({ since: "2026-11-12", expires: "2026-11-20" })], "2026-11-10", "/api/v1/farm-prices?country=IE").hit, null);
});
