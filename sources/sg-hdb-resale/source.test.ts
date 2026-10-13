import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSgUrl, parseSgRecords } from "./source";

test("SG url and records parse (shape seen on data.gov.sg)", () => {
  const url = new URL(buildSgUrl("tampines", "4 room"));
  const filters = JSON.parse(url.searchParams.get("filters")!);
  assert.deepEqual(filters, { town: "TAMPINES", flat_type: "4 ROOM" });
  assert.equal(url.searchParams.get("sort"), "month desc");
  const recs = parseSgRecords({
    success: true,
    result: { records: [
      { _id: 1, month: "2026-08", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "92", resale_price: "615000" },
      { _id: 2, month: "2026-07", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "93", resale_price: 640000 },
    ] },
  });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].price, 615000);
});
