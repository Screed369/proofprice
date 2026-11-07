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

test("stale summary names rent room keys in words", () => {
  assert.equal(staleLead("rooms-00", "Sweden").lead, "rented flats (all sizes) in Sweden: ");
  assert.equal(staleLead("rooms-2", "Greater Stockholm").lead, "rented flats with 2 rooms in Greater Stockholm: ");
  assert.equal(staleLead("rooms-1", "Oslo").item, "rented flats with 1 room");
});
