import test from "node:test";
import assert from "node:assert/strict";
import { harvestOrder } from "../lib/library/harvest-order";

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
