// Tests for the AAFC weekly wholesale source. The fixture is real AAFC data (see ./fixtures.ts, checked 2026-10-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { INFO, cartonKg, centreKey, harvestFromText, matchCommodities, parseNewestWeek, snapshotOf, splitCsvLine, caAafcAnswer, libraryRows } from "./source";
import { AAFC_CSV } from "./fixtures";

const harvest = harvestFromText(AAFC_CSV);
const snap = snapshotOf({ date: harvest.date, rows: harvest.rows as any });

test("licence, type and the asking-price label", () => {
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.licence, /Open Government Licence - Canada/);
  assert.match(INFO.limits, /not paid prices/);
});

test("csv line splitting keeps quoted commas", () => {
  assert.deepEqual(splitCsvLine('2025-10-03,"Wholesale-Edmonton","Peppers, Sweet",,35'), ["2025-10-03", "Wholesale-Edmonton", "Peppers, Sweet", "", "35"]);
});

test("carton weight: lbs, grams and ounces with a pack count; blank pack count means one; no weight means no price per kg", () => {
  assert.ok(Math.abs(cartonKg("", "35", "lbs")! - 15.8757) < 0.001);
  assert.ok(Math.abs(cartonKg("12", "100", "Gr")! - 1.2) < 1e-9);
  assert.ok(Math.abs(cartonKg("12", "4", "Oz")! - 1.3608) < 0.001);
  assert.equal(cartonKg("", "", ""), null);
  assert.equal(cartonKg("12", "1", "Lt"), null);
});

test("real rows: the alfalfa sprouts quote converts to about C$20 per kg", () => {
  const week = parseNewestWeek(AAFC_CSV);
  assert.equal(week.date, "2025-10-03");
  assert.ok(week.quotes.length > 20);
  // 23.90 per carton of 12 x 100 g = 1.2 kg at Edmonton -> 19.92 per kg
  const alfalfa = week.quotes.filter((q) => q.commodity === "alfalfa sprouts" && q.centre === "Edmonton");
  assert.equal(alfalfa.length, 1);
  assert.ok(Math.abs(alfalfa[0].perKg - 19.917) < 0.01, String(alfalfa[0].perKg));
});

test("layout change is reported in words", () => {
  assert.throws(() => parseNewestWeek("Date,Centre\n2025-10-03,x"), /changed the layout/);
});

test("5-quote rule: commodities with fewer than 5 quotes are not in the library", () => {
  assert.ok(harvest.rows.every((r) => r.n >= 5));
  assert.ok(!snap.byArea.get("ALL")!.has("cherries"));
  assert.ok(!snap.byArea.get("ALL")!.has("alfalfa sprouts"));
  assert.equal(libraryRows([]).length, 0);
});

test("harvest result is dated by the newest week and priced in CAD per kg", () => {
  assert.equal(harvest.date, "2025-10-03");
  assert.equal(harvest.currency, "CAD");
  assert.equal(harvest.unit, "per kg");
  assert.match(harvest.note ?? "", /Asking prices/);
});

test("beets: a plausible wholesale price per kg with a range and a quote count", () => {
  const a = caAafcAnswer(snap, { product: "beets" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price!.currency, "CAD");
  assert.ok(a.price!.value > 0.5 && a.price!.value < 6, String(a.price!.value));
  assert.ok(a.price!.typical_low! <= a.price!.value && a.price!.value <= a.price!.typical_high!);
  assert.ok(a.sample_size! >= 5);
  assert.match(a.summary, /asked|quoted/i);
  assert.match(a.summary, /per kg/);
  assert.match(a.statistic?.note ?? "", /asking prices/);
});

test("one centre, and singular/plural forms", () => {
  const a = caAafcAnswer(snap, { product: "Carrot", market: "Wholesale-Vancouver" });
  assert.equal(a.status === "ok" || a.status === "no_matches", true);
  assert.deepEqual(matchCommodities(["carrots", "beets"], "carrot"), ["carrots"]);
  assert.equal(centreKey(snap, "calgary"), "Calgary");
  assert.equal(centreKey(snap, ""), "ALL");
});

test("unknown centre and missing product are input errors that name the valid choices", () => {
  assert.throws(() => caAafcAnswer(snap, { product: "beets", market: "Toronto" }), /Calgary/);
  assert.throws(() => caAafcAnswer(snap, { product: "" }), InputError);
});

test("an unknown product says what we hold and returns no price", () => {
  const a = caAafcAnswer(snap, { product: "dragonfruit" });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Beets/);
});
