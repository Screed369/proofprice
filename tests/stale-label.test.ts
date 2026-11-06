import test from "node:test";
import assert from "node:assert/strict";
import { staleLead } from "../lib/stale";

test("stale summary never prints an internal item key", () => {
  const r = staleLead("Brown Eggs|piece", "Brown Eggs per piece, United Arab Emirates");
  assert.equal(r.lead, "Brown Eggs per piece, United Arab Emirates: ");
  assert.equal(r.item, "Brown Eggs");
});

test("stale summary keeps the plain item wording", () => {
  const r = staleLead("diesel", "Madrid");
  assert.equal(r.lead, "diesel in Madrid: ");
  assert.equal(r.item, "diesel");
});
