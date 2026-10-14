import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, confidenceLabel, percentile } from "../lib/stats";
import { buildAnswer, buildStatisticAnswer } from "../lib/answer";
import type { SourceInfo } from "../lib/plugin";
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

test("range answers keep every field and add value + measure (backwards compatible)", () => {
  const ok = buildAnswer({ source: SG, query: { q: 1 }, summary: summarise([500000, 520000, 540000, 560000, 580000, 600000]), currency: "SGD", unit: "per flat", period: { from: "2026-01", to: "2026-08" }, method: "m", describe: () => "x" });
  assert.deepEqual(ok.price, {
    currency: "SGD",
    unit: "per flat",
    value: 550000,
    measure: "median",
    median: 550000,
    typical_low: 510000,
    typical_high: 590000,
    min: 500000,
    max: 600000,
  });
  assert.equal(ok.sample_size, 6);
  assert.equal(ok.confidence, "low");
  assert.equal(ok.price_type, "transaction");
  assert.ok(!("statistic" in ok), "range answers carry no statistic block");
  const none = buildAnswer({ source: SG, query: {}, summary: null, currency: "SGD", unit: "per flat", period: { from: null, to: null }, method: "m", describe: () => "x" });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.equal(none.sample_size, 0);
});

const OFFICIAL: SourceInfo = {
  id: "test-stat",
  country: "EU",
  category: "energy",
  name: "Household electricity prices",
  publisher: "Eurostat",
  what_is_recorded: "x",
  price_type: "official_statistic",
  freshness: "Half-yearly",
  licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Eurostat",
  homepage: "https://ec.europa.eu/eurostat",
  limits: "x",
};

const statBase = {
  source: OFFICIAL,
  query: { country: "IE", energy: "electricity" },
  currency: "EUR",
  unit: "per kWh",
  period: { from: "2026-01-01", to: "2026-06-30" },
  reference_period: "2026-S1",
  method: "Published average, passed on unchanged.",
  describe: (v: number) => `Households paid on average EUR ${v} per kWh.`,
};

test("official statistic answer: an average with no range and no sample size", () => {
  const a = buildStatisticAnswer({ ...statBase, value: 0.3871, measure: "average", baseUrl: "https://example.test" });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, {
    currency: "EUR",
    unit: "per kWh",
    value: 0.3871,
    measure: "average",
    median: null,
    typical_low: null,
    typical_high: null,
    min: null,
    max: null,
  });
  assert.equal(a.sample_size, null);
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.statistic, { measure: "average", reference_period: "2026-S1" });
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-06-30" });
  assert.equal(a.summary, "Households paid on average EUR 0.3871 per kWh. Official average published by Eurostat for 2026-S1.");
  assert.equal(a.method_url, "https://example.test/method");
  assert.deepEqual(a.source, {
    id: "test-stat",
    name: "Household electricity prices",
    publisher: "Eurostat",
    licence: "CC BY 4.0",
    licence_url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Source: Eurostat",
    url: "https://ec.europa.eu/eurostat",
  });
  assert.match(a.notice, /Information, not a valuation or offer/);
  assert.ok(!("extra" in a));
});

test("official statistic answer: a published median fills median, and a published range and sample size are passed on", () => {
  const a = buildStatisticAnswer({
    ...statBase,
    value: 1200,
    measure: "median",
    low: 900,
    high: 1700,
    sample_size: 4321,
    note: "Provisional figure.",
    extra: { dataset: "x" },
  });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1200);
  assert.equal(a.price!.measure, "median");
  assert.equal(a.price!.median, 1200);
  assert.equal(a.price!.typical_low, 900);
  assert.equal(a.price!.typical_high, 1700);
  assert.equal(a.price!.min, null);
  assert.equal(a.price!.max, null);
  assert.equal(a.sample_size, 4321);
  assert.deepEqual(a.statistic, { measure: "median", reference_period: "2026-S1", note: "Provisional figure." });
  assert.match(a.summary, /Official median published by Eurostat for 2026-S1\.$/);
  assert.deepEqual(a.extra, { dataset: "x" });
});

test("official statistic answer: no figure (null, zero, negative, NaN) is no_matches with no price", () => {
  for (const value of [null, 0, -1, NaN, Infinity]) {
    const a = buildStatisticAnswer({ ...statBase, value, measure: "average" });
    assert.equal(a.status, "no_matches", String(value));
    assert.equal(a.price, null);
    assert.equal(a.sample_size, null);
    assert.equal(a.confidence, "insufficient");
    assert.match(a.summary, /^No matching official statistic found in Household electricity prices \(Eurostat\)/);
  }
});
