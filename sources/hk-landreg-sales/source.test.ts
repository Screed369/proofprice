import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseBand, parseCount, parseYear, stripBom, bandPercentile, estimate, answerFrom, hkLandRegSales, INFO, type Band } from "./source";
import { findSource } from "../../lib/registry";

// Fixture: consideration_2026.json exactly as probed 2026-10-30 (UTF-8, 22 rows: 21 bands + Total; Jan..Sep filled, Oct..Dec blank).
const fixture = JSON.parse(stripBom(readFileSync(path.join(__dirname, "fixtures", "consideration_2026.json"), "utf8")));

test("HK-LR: bands and counts parse (thousands commas, blank = not published)", () => {
  assert.deepEqual(parseBand("Less than 1"), { label: "Less than 1", lo: 0, hi: 1_000_000 });
  assert.deepEqual(parseBand("3 to less than 4"), { label: "3 to less than 4", lo: 3_000_000, hi: 4_000_000 });
  assert.deepEqual(parseBand("20 or above"), { label: "20 or above", lo: 20_000_000, hi: null });
  assert.equal(parseBand("Total"), null);
  assert.equal(parseCount("1,075"), 1075);
  assert.equal(parseCount(""), null);
  assert.equal(stripBom("﻿[]"), "[]");
});

test("HK-LR: the 2026 file gives 21 bands and 9 published months; the Total row is dropped", () => {
  const { bands, months } = parseYear(fixture, 2026);
  assert.equal(bands.length, 21);
  assert.deepEqual(months.map((m) => m.month), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  // our band sums equal the publisher's own Total row for every month
  const total = fixture.find((r: any) => r["Range of Consideration ($ million)"] === "Total");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  months.forEach((m, i) => assert.equal(m.counts.reduce((a, b) => a + b, 0), parseCount(total[names[i]])));
  assert.equal(months[8].counts.reduce((a, b) => a + b, 0), 4761);
});

test("HK-LR: percentile interpolation inside bands and the open top band", () => {
  const bands: Band[] = [
    { label: "a", lo: 0, hi: 1_000_000 },
    { label: "b", lo: 1_000_000, hi: 2_000_000 },
    { label: "c", lo: 2_000_000, hi: null },
  ];
  assert.equal(bandPercentile(bands, [50, 50, 0], 0.5).value, 1_000_000);
  assert.equal(bandPercentile(bands, [100, 0, 0], 0.5).value, 500_000);
  const top = bandPercentile(bands, [0, 0, 10], 0.9);
  assert.deepEqual(top, { value: 2_000_000, floor: true });
});

test("HK-LR: 12-month estimate from the fixture is plausible and counts the deals", () => {
  const { bands, months } = parseYear(fixture, 2026);
  const e = estimate(bands, months, 3)!;
  assert.equal(e.deals, 4019 + 4462 + 4761);
  assert.equal(e.from, "2026-07");
  assert.equal(e.to, "2026-09");
  assert.ok(e.median > 5_000_000 && e.median < 8_000_000, `median ${e.median}`);
  assert.ok(e.low < e.median && e.median < e.high);
  assert.ok(e.low >= 1_000_000 && e.high <= 20_000_000);
});

test("HK-LR: the answer says it is an estimate from bands, low confidence, no fake min/max", () => {
  const { bands, months } = parseYear(fixture, 2026);
  const a = answerFrom(bands, months, 12);
  assert.equal(a.status, "ok");
  assert.equal(a.confidence, "low");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.min, null);
  assert.equal(a.price!.max, null);
  assert.ok(a.sample_size! > 40_000);
  assert.equal(a.period.from, "2026-01-01");
  assert.equal(a.period.to, "2026-09-30");
  assert.equal((a.extra as any).estimated_from_price_bands, true);
  assert.match(a.summary, /estimated from price bands/);
  assert.match(a.source.attribution, /Land Registry, HKSAR Government, via DATA\.GOV\.HK/);
  assert.equal(INFO.price_type, "transaction");
});

test("HK-LR: no data in the window is no_matches, not a made-up figure", () => {
  const { bands } = parseYear(fixture, 2026);
  const a = answerFrom(bands, [], 12);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("HK-LR: inputs this source cannot honour are refused", async () => {
  await assert.rejects(hkLandRegSales({ postcode: "999077" }), /Postcode is not supported/);
  await assert.rejects(hkLandRegSales({ property_type: "house" }), /one figure for all homes/);
});

test("HK-LR: routing - no town goes to the Land Registry, an estate to the Housing Authority", () => {
  assert.equal(findSource("home-sales", "HK", { country: "HK" })!.info.id, "hk-landreg-sales");
  assert.equal(findSource("home-sales", "HK", { country: "HK", months: 24 })!.info.id, "hk-landreg-sales");
  assert.equal(findSource("home-sales", "HK", { country: "HK", town: "Shan King" })!.info.id, "hk-ha-tps-sales");
});
