// The data checker in the collector (lib/library/check.ts): a key that jumps above 3x or below a third of its previous value,
// or a change of currency or unit, is not published and is recorded in meta.json last_error. A first harvest is exempt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pp-check-"));
process.env.PROOFPRICE_LIBRARY_DIR = dir;

import { MAX_RATIO, dataCheck, keyOf, previousByKey } from "../lib/library/check";
import { readDaily, writeDaily, writeMeta } from "../lib/library/store";
import type { SourceMeta } from "../lib/library/store";
import type { DailyRow, HarvestResult } from "../lib/plugin";

const row = (area: string, item: string, median: number, n = 40): DailyRow => ({ area, item, n, median, low: median * 0.9, high: median * 1.1, min: median * 0.8, max: median * 1.2 });
const day = (date: string, rows: DailyRow[], currency = "EUR", unit = "per litre"): HarvestResult => ({ date, currency, unit, rows });
const meta = (currency = "EUR", unit = "per litre"): SourceMeta => ({
  source: "es-fuel", currency, unit, first_date: "2026-10-01", last_date: "2026-10-01", days: 1, last_harvest_at: null, last_rows: 2, last_ok_at: "x", last_error: null,
});

// yesterday: two keys
writeDaily("es-fuel", day("2026-10-01", [row("28", "diesel", 1.5), row("08", "diesel", 1.6)]));
const previous = () => previousByKey("es-fuel", "2026-10-02");

test("a normal day passes untouched", () => {
  const r = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 1.52), row("08", "diesel", 1.58)]), prevMeta: meta(), previous: previous() });
  assert.equal(r.rows.length, 2);
  assert.equal(r.held.length, 0);
  assert.equal(r.message, null);
  assert.equal(r.unitChange, null);
});

test("above 3x or below a third is held back and named; the other keys are still published", () => {
  const r = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 4.6), row("08", "diesel", 1.6)]), prevMeta: meta(), previous: previous() });
  assert.deepEqual(r.rows.map((x) => x.area), ["08"]);
  assert.deepEqual(r.held.map((h) => `${h.area}/${h.item}`), ["28/diesel"]);
  assert.match(r.message!, /^Data check held back 1 key for 2026-10-02 \(previous kept\): 28\/diesel: median 4\.6 vs previous 1\.5 on 2026-10-01 \(3\.07x\)\.$/);

  const low = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 0.4), row("08", "diesel", 1.6)]), prevMeta: meta(), previous: previous() });
  assert.deepEqual(low.held.map((h) => h.area), ["28"]);
  assert.match(low.message!, /0\.27x/);
});

test("the limit is strict: exactly 3x and exactly a third pass", () => {
  assert.equal(MAX_RATIO, 3);
  const edge = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 4.5), row("08", "diesel", 1.6 / 3)]), prevMeta: meta(), previous: previous() });
  assert.equal(edge.held.length, 0);
  assert.equal(edge.rows.length, 2);
});

test("a change of currency or unit publishes nothing for the source", () => {
  const unit = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 1.5)], "EUR", "per 100 litres"), prevMeta: meta(), previous: previous() });
  assert.equal(unit.rows.length, 0);
  assert.match(unit.unitChange!, /changed from EUR per litre to EUR per 100 litres; nothing published for 2026-10-02 \(previous kept\)/);
  const cur = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 1.5)], "GBP"), prevMeta: meta(), previous: previous() });
  assert.match(cur.unitChange!, /GBP/);
});

test("a source's first harvest is exempt, and so is a key with no previous value", () => {
  const first = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 9999)], "USD", "per barrel"), prevMeta: null, previous: new Map() });
  assert.equal(first.rows.length, 1);
  assert.equal(first.message, null);
  const newKey = dataCheck({ result: day("2026-10-02", [row("99", "diesel", 50)]), prevMeta: meta(), previous: previous() });
  assert.equal(newKey.rows.length, 1);
  assert.equal(newKey.held.length, 0);
});

test("thin rows are not compared, many held keys are counted, and the previous value stays in the library", () => {
  const thin = dataCheck({ result: day("2026-10-02", [row("28", "diesel", 99, 3)]), prevMeta: meta(), previous: previous() });
  assert.equal(thin.held.length, 0);

  const many: DailyRow[] = [];
  const base: DailyRow[] = [];
  for (let i = 0; i < 8; i++) {
    base.push(row(`A${i}`, "diesel", 1));
    many.push(row(`A${i}`, "diesel", 10));
  }
  writeDaily("it-fuel", day("2026-10-01", base));
  const prev = previousByKey("it-fuel", "2026-10-02");
  assert.equal(prev.size, 8);
  const r = dataCheck({ result: day("2026-10-02", many), prevMeta: { ...meta(), source: "it-fuel" }, previous: prev });
  assert.equal(r.held.length, 8);
  assert.match(r.message!, /held back 8 keys/);
  assert.match(r.message!, /; and 3 more\.$/);

  // writing only the kept rows leaves yesterday's value in place
  writeDaily("es-fuel", { ...day("2026-10-02", [row("28", "diesel", 4.6), row("08", "diesel", 1.6)]), rows: dataCheck({ result: day("2026-10-02", [row("28", "diesel", 4.6), row("08", "diesel", 1.6)]), prevMeta: meta(), previous: previous() }).rows });
  assert.equal(readDaily("es-fuel", { area: "28", item: "diesel", from: "2026-10-01", to: "2026-10-31" }).length, 1);
  assert.equal(readDaily("es-fuel", { area: "08", item: "diesel", from: "2026-10-01", to: "2026-10-31" }).length, 2);
});

test("previousByKey takes the newest earlier day for each key, across months, and ignores the day itself", () => {
  writeDaily("fr-fuel", day("2026-09-29", [row("69", "diesel", 1.7)]));
  writeDaily("fr-fuel", day("2026-10-03", [row("69", "diesel", 1.8)]));
  writeDaily("fr-fuel", day("2026-10-05", [row("69", "diesel", 1.9)]));
  const p = previousByKey("fr-fuel", "2026-10-05");
  assert.equal(p.get(keyOf("69", "diesel"))!.median, 1.8);
  assert.equal(previousByKey("fr-fuel", "2026-10-01").get(keyOf("69", "diesel"))!.median, 1.7);
  assert.equal(previousByKey("nothing-here", "2026-10-05").size, 0);
});

test("a published annual-change rate (item ending :yoy) is never ratio-checked", () => {
  writeDaily("gb-rate", day("2026-10-01", [row("E1", "flat:yoy", 0.3)], "GBP", "per month"));
  const prev = previousByKey("gb-rate", "2026-10-02");
  const r = dataCheck({ result: day("2026-10-02", [row("E1", "flat:yoy", 1.4), row("E1", "flat", 900)], "GBP", "per month"), prevMeta: { ...meta("GBP", "per month"), source: "gb-rate" }, previous: prev });
  assert.equal(r.held.length, 0);
  assert.equal(r.rows.length, 2);
});

test("a spot-price key whose median sits near zero is not frozen by the ratio test (VIC1 0.01 then 96.06)", () => {
  const spot = (median: number, low: number, high: number): DailyRow => ({ area: "VIC1", item: "spot-5min", n: 288, median, low, high, min: -20, max: 299 });
  writeDaily("au-spot", day("2026-10-22", [spot(0.01, -7.96, 149)], "AUD", "per MWh"));
  const prev = previousByKey("au-spot", "2026-10-23");
  const r = dataCheck({ result: day("2026-10-23", [spot(96.06, 20, 180)], "AUD", "per MWh"), prevMeta: { ...meta("AUD", "per MWh"), source: "au-spot" }, previous: prev });
  assert.equal(r.held.length, 0);
  assert.equal(r.rows.length, 1);
  // a tight fuel-like series is still checked
  writeDaily("tight", day("2026-10-22", [row("x", "d", 1.5)]));
  const t = dataCheck({ result: day("2026-10-23", [row("x", "d", 6)]), prevMeta: meta(), previous: previousByKey("tight", "2026-10-23") });
  assert.equal(t.held.length, 1);
});
