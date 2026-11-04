// docs/blocked-hosts.json: every entry must say which host, what happened, when, and who found it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("blocked-hosts list: every entry has host, symptom, date and found_by", () => {
  const data = JSON.parse(readFileSync("docs/blocked-hosts.json", "utf8"));
  assert.ok(Array.isArray(data.hosts) && data.hosts.length > 0);
  const seen = new Set<string>();
  for (const h of data.hosts) {
    assert.match(String(h.host), /^[a-z0-9.-]+\.[a-z]{2,}$/, `bad host ${h.host}`);
    assert.ok(String(h.symptom).length >= 10, `${h.host}: symptom too short`);
    assert.match(String(h.date), /^\d{4}-\d{2}-\d{2}$/, `${h.host}: date must be YYYY-MM-DD`);
    assert.ok(String(h.found_by).length > 0, `${h.host}: found_by missing`);
    assert.ok(!seen.has(h.host), `${h.host} listed twice`);
    seen.add(h.host);
  }
});
