import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, confidenceLabel, percentile } from "../lib/stats";
import { buildAnswer } from "../lib/answer";
import { INFO as SG } from "../sources/sg-hdb-resale/source";

test("percentiles and summary", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  const s = summarise([300000, 250000, 400000, 275000, 320000, 0, NaN])!;
  assert.equal(s.count, 5);
  assert.equal(s.median, 300000);
  assert.ok(s.low < s.median && s.median < s.high);
  assert.equal(summarise([]), null);
});

test("confidence labels and publish threshold", () => {
  assert.equal(confidenceLabel(4), "insufficient");
  assert.equal(confidenceLabel(5), "low");
  assert.equal(confidenceLabel(15), "medium");
  assert.equal(confidenceLabel(50), "high");
});

test("answer refuses to publish below 5 records and is citable above", () => {
  const thin = buildAnswer({ source: SG, query: {}, summary: summarise([1, 2, 3]), currency: "SGD", unit: "per flat", period: { from: null, to: null }, method: "m", describe: () => "x" });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  const ok = buildAnswer({ source: SG, query: {}, summary: summarise([500000, 520000, 540000, 560000, 580000, 600000]), currency: "SGD", unit: "per flat", period: { from: "2026-01", to: "2026-08" }, method: "m", describe: () => "Flats sold for a median of S$550,000." });
  assert.equal(ok.status, "ok");
  assert.ok(ok.price && ok.price.median === 550000);
  assert.match(ok.summary, /Based on 6 records/);
  assert.match(ok.source.attribution, /Singapore Open Data Licence/);
});
