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

// SYNTHETIC rounds in the parsed shape (two a month), to test the answer wording and the window.
function rounds(): import("./source").CoeRound[] {
  const out: import("./source").CoeRound[] = [];
  const months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  months.forEach((m, i) => {
    for (const round of [1, 2]) {
      if (m === "2026-10" && round === 2) continue; // not held yet
      out.push({ month: m, round, cls: "A", quota: 1000, bidsSuccess: 1000, bidsReceived: 1500, premium: 100000 + i * 2000 + round });
      out.push({ month: m, round, cls: "B", quota: 800, bidsSuccess: 800, bidsReceived: 900, premium: 120000 });
    }
  });
  return out.reverse(); // oldest last: the answer must not depend on input order
}

test("sg-coe answer: latest round leads, the range is described as over rounds through time", async () => {
  const { coeAnswer } = await import("./source");
  const a = coeAnswer(rounds(), "A", 12, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  // 12 calendar months: 2025-11 .. 2026-10 (2025-10 and older excluded), 11 full months x 2 rounds + 1 round in October.
  assert.deepEqual(a.period, { from: "2025-11", to: "2026-10" });
  assert.equal(a.sample_size, 23);
  assert.equal((a.extra as any).latest_round, "2026-10 round 1");
  assert.equal((a.extra as any).latest_premium, 100000 + 13 * 2000 + 1);
  assert.match(a.summary, /latest bidding round \(2026-10 round 1\) cleared at SGD\s126,001/);
  assert.match(a.summary, /Across the 23 bidding rounds in the period/);
  assert.match(a.summary, /10th–90th percentile range/);
  assert.match(a.summary, /over rounds through time, not between buyers/);
  assert.doesNotMatch(a.summary, /typical range/);
  assert.match(a.method, /not a spread of prices paid by different buyers/);
  assert.equal(a.price?.unit, "per COE (10-year right to own a vehicle; vehicle not included)");
});

test("sg-coe answer: fewer than 5 rounds gives no range", async () => {
  const { coeAnswer } = await import("./source");
  const a = coeAnswer(rounds(), "A", 2, new Date("2026-10-14T00:00:00Z")); // 2026-09 (2 rounds) + 2026-10 (1 round)
  assert.equal(a.sample_size, 3);
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("sg-coe parse: empty or 'na' premiums are dropped, never counted as 0", () => {
  const r = parseCoeRecords({ success: true, result: { records: [
    { month: "2026-10", bidding_no: "1", vehicle_class: "Category A", quota: "1", bids_success: "1", bids_received: "1", premium: "" },
    { month: "2026-10", bidding_no: "1", vehicle_class: "Category B", quota: "1", bids_success: "1", bids_received: "1", premium: "na" },
  ] } });
  assert.equal(r.length, 0);
});
