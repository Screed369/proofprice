import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoeUrl, normaliseClass, parseCoeRecords } from "./source";

// Fixture copied from the live data.gov.sg datastore_search answer, checked 2026-10-14.
const fixture = {
  success: true,
  result: {
    records: [
      { _id: 1985, month: "2026-10", bidding_no: "1", vehicle_class: "Category E", quota: "253", bids_success: "229", bids_received: "492", premium: "137000" },
      { _id: 1981, month: "2026-10", bidding_no: "1", vehicle_class: "Category A", quota: "1232", bids_success: "1232", bids_received: "1560", premium: "130001" },
      { _id: 1980, month: "2026-09", bidding_no: "2", vehicle_class: "Category E", quota: "269", bids_success: "253", bids_received: "431", premium: "137000" },
      { _id: 1, month: "bad", bidding_no: "1", vehicle_class: "Category A", quota: "1", bids_success: "1", bids_received: "1", premium: "0" },
    ],
  },
};

test("sg-coe parses rows, dropping invalid ones", () => {
  const r = parseCoeRecords(fixture);
  assert.equal(r.length, 3);
  assert.deepEqual({ cls: r[1].cls, month: r[1].month, premium: r[1].premium, bids: r[1].bidsSuccess, round: r[1].round }, { cls: "A", month: "2026-10", premium: 130001, bids: 1232, round: 1 });
});
test("sg-coe rejects an unexpected response", () => {
  assert.throws(() => parseCoeRecords({ success: false }));
});
test("sg-coe normalises the class", () => {
  assert.equal(normaliseClass(), "A");
  assert.equal(normaliseClass("category b"), "B");
  assert.throws(() => normaliseClass("Z"));
});
test("sg-coe builds a filtered URL", () => {
  assert.deepEqual(JSON.parse(new URL(buildCoeUrl("D")).searchParams.get("filters")!), { vehicle_class: "Category D" });
});
