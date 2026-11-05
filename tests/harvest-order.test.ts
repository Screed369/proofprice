import test from "node:test";
import assert from "node:assert/strict";
import { harvestOrder, isCopyAtRisk } from "../lib/library/harvest-order";

const t = (id: string) => ({ info: { id } });
test("harvest order: healthy first, oldest harvest first, outages last, never-harvested first", () => {
  const meta: Record<string, any> = {
    a: { last_harvest_at: "2026-11-01T10:00:00Z" },
    b: { last_harvest_at: "2026-10-31T10:00:00Z" }, // skipped yesterday: leads
    c: { last_harvest_at: "2026-10-31T10:00:00Z", last_error: "Source timed out" }, // outage: after healthy ones
    d: null, // never harvested
    e: { last_harvest_at: "2026-10-30T10:00:00Z", last_error: "Data check held back: x" }, // held, not an outage
  };
  const out = harvestOrder([t("a"), t("b"), t("c"), t("d"), t("e")], (id) => meta[id]).map((x) => x.info.id);
  assert.deepEqual(out, ["d", "e", "b", "a", "c"]);
});
test("harvest order is stable for equal keys", () => {
  const out = harvestOrder([t("x"), t("y"), t("z")], () => null).map((x) => x.info.id);
  assert.deepEqual(out, ["x", "y", "z"]);
});
test("harvest order: a failing source whose copy is 2-7 days old goes first; one down longer goes last", () => {
  const now = Date.parse("2026-11-05T04:00:00Z");
  const meta: Record<string, any> = {
    healthy: { last_harvest_at: "2026-11-04T10:00:00Z", last_ok_at: "2026-11-04T10:00:00Z" },
    tw: { last_harvest_at: "2026-11-03T11:00:00Z", last_ok_at: "2026-11-02T11:00:00Z", last_error: "fetch failed" }, // 2.7 days: at risk
    gone: { last_harvest_at: "2026-10-30T11:00:00Z", last_ok_at: "2026-10-27T11:00:00Z", last_error: "timeout" }, // 9 days: nothing to save
    fresh: { last_harvest_at: "2026-11-05T01:00:00Z", last_ok_at: "2026-11-04T10:00:00Z", last_error: "blip" }, // 0.7 days: normal outage
  };
  const out = harvestOrder([t("healthy"), t("gone"), t("fresh"), t("tw")], (id) => meta[id], now).map((x) => x.info.id);
  assert.deepEqual(out, ["tw", "healthy", "gone", "fresh"]);
  assert.equal(isCopyAtRisk(meta.tw, now), true);
  assert.equal(isCopyAtRisk(meta.gone, now), false);
  assert.equal(isCopyAtRisk(meta.healthy, now), false);
  assert.equal(isCopyAtRisk(null, now), false);
});
