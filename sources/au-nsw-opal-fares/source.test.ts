// Tests for the NSW Opal fare table. fixtures/opal-fares-trimmed.xlsx holds the REAL cells of three sheets of the workbook
// "Open Data Opal Distance Tables and Opal Fare Values" (https://opendata.transport.nsw.gov.au/data/dataset/opal-fares, resource 08722006-...),
// downloaded 2026-11-03: the visible 'Opal Fare Values' (still the July 2025 fares), 'Opal Fare Values 1 July 2025' and the HIDDEN
// 'Opal Fare Values 29 June 2026' (the current fares). Outside check: the publisher's Business Rules PDF v1.7 worked examples use
// $4.49 (bus 3-8 km peak) and $5.77 (bus 8 km+ peak), the same cells as the 29 June 2026 sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { INFO, answerFromTable, bandIndex, EDGES, opalFares, opalHarvest, opalHistoryKey, parseBand, pickTable, readFareSheets, rowsFromTable, sheetDate } from "./source";

const sheets = readFareSheets(readFileSync(new URL("./fixtures/opal-fares-trimmed.xlsx", import.meta.url)));
const TABLE = pickTable(sheets, "2026-11-03");

test("licence and type", () => {
  assert.match(INFO.licence, /Creative Commons Attribution/);
  assert.equal(INFO.price_type, "posted_price");
});

test("sheet dates and bands", () => {
  assert.equal(sheetDate("Opal Fare Values 29 June 2026"), "2026-06-29");
  assert.equal(sheetDate("Opal Fare Values 5 July 2021"), "2021-07-05");
  assert.equal(sheetDate("Opal Fare Values"), null);
  assert.equal(sheetDate("Rail"), null);
  assert.deepEqual(parseBand("0-10km"), { from: 0, to: 10 });
  assert.deepEqual(parseBand("65km+"), { from: 65, to: Infinity });
  assert.deepEqual(parseBand("8km+"), { from: 8, to: Infinity });
  assert.equal(parseBand("Stockton"), null);
});

test("uses the hidden 29 June 2026 sheet, not the visible plain-named one", () => {
  assert.ok(sheets.some((s) => s.name === "Opal Fare Values"));
  assert.equal(TABLE.sheet, "Opal Fare Values 29 June 2026");
  assert.equal(TABLE.effective, "2026-06-29");
  // before that date takes effect, the 1 July 2025 sheet is the current one
  assert.equal(pickTable(sheets, "2026-01-01").effective, "2025-07-01");
  assert.throws(() => pickTable(sheets, "2020-01-01"), SourceError);
});

test("real fares, current sheet", () => {
  const train = answerFromTable(TABLE, { mode: "train", distance_km: 5 });
  assert.equal(train.status, "ok");
  assert.equal(train.price!.currency, "AUD");
  assert.equal(train.price!.value, 4.33);
  assert.equal(train.sample_size, null);
  assert.equal(train.price_type, "posted_price");
  assert.equal(answerFromTable(TABLE, { mode: "train", distance_km: 5, travel_time: "early" }).price!.value, 3.03);
  assert.equal(answerFromTable(TABLE, { mode: "train", distance_km: 70 }).price!.value, 10.66);
  assert.equal(answerFromTable(TABLE, { mode: "train", distance_km: 10 }).price!.value, 4.33); // exactly 10 km is in the 0-10 band
  assert.equal(answerFromTable(TABLE, { mode: "train", distance_km: 10.1 }).price!.value, 5.38);
  assert.equal(answerFromTable(TABLE, { mode: "ferry", distance_km: 5 }).price!.value, 7.35);
  assert.equal(answerFromTable(TABLE, { mode: "ferry", distance_km: 12, travel_time: "early" }).price!.value, 9.2); // no ferry off-peak discount
  assert.equal(answerFromTable(TABLE, { mode: "light rail", distance_km: 2 }).price!.value, 3.3);
});

test("the publisher's own worked examples match: bus 3-8 km $4.49, bus 8 km+ $5.77 (Business Rules PDF v1.7)", () => {
  assert.equal(answerFromTable(TABLE, { mode: "bus", distance_km: 5 }).price!.value, 4.49);
  assert.equal(answerFromTable(TABLE, { mode: "bus", distance_km: 9 }).price!.value, 5.77);
});

test("child/youth and senior use the concession columns", () => {
  const s = answerFromTable(TABLE, { mode: "bus", fare_type: "student", distance_km: 5 });
  assert.equal(s.price!.value, 2.24);
  const sen = answerFromTable(TABLE, { mode: "train", fare_type: "senior", distance_km: 5 });
  assert.equal(sen.price!.value, 2.16);
  assert.match(String(sen.statistic?.note), /2\.50/);
});

test("input handling", async () => {
  assert.throws(() => answerFromTable(TABLE, { mode: "rocket" }), InputError);
  assert.throws(() => answerFromTable(TABLE, { fare_type: "workfare" }), InputError);
  assert.throws(() => answerFromTable(TABLE, { travel_time: "night" }), InputError);
  assert.throws(() => answerFromTable(TABLE, { distance_km: -1 }), InputError);
  await assert.rejects(() => opalFares({ mode: "rocket" }, async () => { throw new Error("must not be called"); }), InputError);
  const def = await opalFares({}, async () => TABLE); // default: adult train 5 km peak
  assert.equal(def.price!.value, 4.33);
});

test("every table cell of the current sheet is a real fare and band edges match", () => {
  assert.equal(TABLE.rows.length, 4 * (5 + 3 + 3 + 2));
  for (const r of TABLE.rows) assert.ok(r.dollars > 0 && r.dollars < 20, `${r.mode} ${r.label}`);
  for (const [mode, edges] of Object.entries(EDGES)) {
    const bands = TABLE.rows.filter((r) => r.mode === mode && r.group === "adult" && r.time === "peak").sort((a, b) => a.index - b.index);
    assert.deepEqual(bands.slice(0, -1).map((b) => b.to), edges);
  }
  assert.equal(bandIndex("train", 66), 4);
});

test("collector rows use NO_COUNT and history keys line up with them", async () => {
  const h = await opalHarvest(async () => TABLE);
  assert.equal(h.date, "2026-06-29");
  assert.equal(h.rows.length, TABLE.rows.length);
  assert.ok(h.rows.every((r) => Number.isNaN(r.n) && Object.is(r.n, NO_COUNT) && r.median === r.low && r.low === r.high));
  const key = opalHistoryKey({ mode: "bus", fare_type: "student", distance_km: 5, travel_time: "early" })!;
  const row = rowsFromTable(TABLE).find((r) => r.area === key.area && r.item === key.item)!;
  assert.equal(row.median, answerFromTable(TABLE, { mode: "bus", fare_type: "student", distance_km: 5, travel_time: "early" }).price!.value);
});
