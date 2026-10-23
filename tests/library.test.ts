import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateDaily } from "../lib/library/aggregate";
import { csvToRows, libraryDates, readDaily, rowsToCsv, writeDaily, writeMeta, libraryStatus } from "../lib/library/store";
import { categoryById, runHistory } from "../lib/registry";
import { NO_COUNT, passesGate } from "../lib/stats";

const dir = mkdtempSync(path.join(tmpdir(), "pp-lib-"));
process.env.PROOFPRICE_LIBRARY_DIR = dir;

const row = (area: string, item: string, n: number, median: number) => ({ area, item, n, median, low: median - 0.05, high: median + 0.05, min: median - 0.1, max: median + 0.1 });

test("aggregate: one row per area and item, plus the whole country", () => {
  const recs = [1.5, 1.6, 1.7].map((price) => ({ area: "28", item: "diesel", price })).concat([{ area: "08", item: "diesel", price: 1.8 }, { area: "", item: "diesel", price: 9 }]);
  const rows = aggregateDaily(recs);
  assert.deepEqual(rows.map((r) => `${r.area}/${r.item}/${r.n}`), ["08/diesel/1", "28/diesel/3", "ALL/diesel/4"]);
  assert.equal(rows.find((r) => r.area === "28")!.median, 1.6);
});

test("store: CSV round trip, quoting, idempotent daily writes, thin rows dropped", () => {
  const csv = rowsToCsv([{ date: "2026-10-14", ...row('A,"B"', "x", 5, 1) }]);
  assert.equal(csvToRows(csv)[0].area, 'A,"B"');
  writeDaily("es-fuel", { date: "2026-10-14", currency: "EUR", unit: "per litre", rows: [row("28", "diesel", 60, 1.5), row("42", "diesel", 3, 1.6)] });
  writeDaily("es-fuel", { date: "2026-10-14", currency: "EUR", unit: "per litre", rows: [row("28", "diesel", 61, 1.51)] });
  const file = readFileSync(path.join(dir, "es-fuel", "daily", "2026-10.csv"), "utf8");
  assert.equal(file.trim().split("\n").length, 2); // header + one row: replaced, and the 3-station row was never stored
  writeDaily("es-fuel", { date: "2026-11-02", currency: "EUR", unit: "per litre", rows: [row("28", "diesel", 59, 1.45)] });
  assert.deepEqual(libraryDates("es-fuel"), ["2026-10-14", "2026-11-02"]);
  assert.equal(readDaily("es-fuel", { area: "28", item: "diesel", from: "2026-10-01", to: "2026-11-30" }).length, 2);
  assert.equal(readDaily("es-fuel", { area: "28", item: "diesel", from: "2026-10-15", to: "2026-11-30" }).length, 1);
});

test("history: a series with the change over the period, honest when empty", () => {
  writeMeta("es-fuel", { source: "es-fuel", currency: "EUR", unit: "per litre", first_date: "2026-10-14", last_date: "2026-11-02", days: 2, last_harvest_at: null, last_rows: 1, last_ok_at: null, last_error: null });
  const fuel = categoryById("fuel")!;
  const h = runHistory(fuel, { country: "ES", postcode: "28001", fuel: "gasoleo", days: 60 }, {}, new Date("2026-11-02T12:00:00Z"));
  assert.equal(h.status, "ok");
  assert.equal(h.series.length, 2);
  assert.equal(h.change!.percent, -4);
  assert.match(h.summary, /Diesel in province 28: median .*1\.45.* down 4%/);
  assert.equal(h.unit, "per litre");
  const none = runHistory(fuel, { country: "ES", area: "42", fuel: "diesel" }, {}, new Date("2026-11-02T12:00:00Z"));
  assert.equal(none.status, "no_history_yet");
  assert.equal(none.series.length, 0);
  assert.equal(libraryStatus()[0].source, "es-fuel");
  // GB now has monthly history only (backfill, no daily collector): a daily request says so and how to ask
  assert.throws(() => runHistory(categoryById("home-sales")!, { country: "GB", town: "Bristol" }), /monthly figures.*months/);
});

test("store: never wipes history (bad header refused, empty day ignored)", () => {
  writeDaily("it-fuel", { date: "2026-10-20", currency: "EUR", unit: "per litre", rows: [row("MI", "diesel", 40, 1.8)] });
  const res = writeDaily("it-fuel", { date: "2026-10-20", currency: "EUR", unit: "per litre", rows: [row("MI", "diesel", 2, 1.9)] });
  assert.equal(res.rows, 0);
  assert.equal(readDaily("it-fuel", { area: "MI", item: "diesel", from: "2026-10-01", to: "2026-10-31" }).length, 1);
  const file = path.join(dir, "it-fuel", "daily", "2026-10.csv");
  writeFileSync(file, "date,area,item,n,median,low,high,min,max,extra\n2026-10-19,MI,diesel,40,1.8,1.7,1.9,1.6,2,x\n");
  assert.throws(() => writeDaily("it-fuel", { date: "2026-10-21", currency: "EUR", unit: "per litre", rows: [row("MI", "diesel", 40, 1.8)] }), /unexpected header/);
  mkdirSync(path.join(dir, "Odd_Folder"), { recursive: true });
  assert.ok(Array.isArray(libraryStatus()));
});

test("history: asks the same questions the live tool accepts", () => {
  const fuel = categoryById("fuel")!;
  const now = new Date("2026-11-02T12:00:00Z");
  assert.throws(() => runHistory(fuel, { country: "FR", fuel: "methane" }, {}, now), /History is kept by area and fuel/);
  assert.throws(() => runHistory(fuel, { country: "ES", area: "Madrid", fuel: "diesel" }, {}, now), /History is kept by area and fuel/);
  assert.throws(() => runHistory(fuel, { country: "IT", area: "Milano", fuel: "diesel" }, {}, now), /History is kept by area and fuel/);
});

test("history: months=N reads the monthly history loaded by the backfill (string from a URL works too)", async () => {
  const { applyBackfill } = await import("../lib/library/backfill");
  const periods = ["2024-01", "2024-02", "2024-03"].map((period, i) => ({ period, rows: [{ ...row("69", "diesel", 80, 1.7 + i * 0.1), area: "69", item: "diesel" }] }));
  applyBackfill("fr-fuel", { currency: "EUR", unit: "per litre", periods, note: "Monthly test note." }, { today: new Date("2026-10-20T00:00:00Z") });
  writeMeta("fr-fuel", { source: "fr-fuel", currency: "EUR", unit: "per litre", first_date: "2026-10-13", last_date: "2026-10-19", days: 7, last_harvest_at: null, last_rows: 1, last_ok_at: null, last_error: null });
  const fuel = categoryById("fuel")!;
  const h = runHistory(fuel, { country: "FR", department: "69", fuel: "diesel", months: "36" } as any, {}, new Date("2026-10-20T12:00:00Z"));
  assert.equal(h.status, "ok");
  assert.deepEqual(h.series.map((s) => s.date), ["2024-01", "2024-02", "2024-03"].filter((d) => d >= "2023-11"));
  assert.match(h.method, /Monthly test note\..*whole month/);
  assert.equal((h.query as any).months, 36);
});

test("/api/v1/library lists only registered sources: an offline source's old folder (at-fuel, au-wa-fuel) is left out", async () => {
  writeMeta("at-fuel", { source: "at-fuel", currency: "EUR", unit: "per litre", first_date: "2026-10-01", last_date: "2026-10-10", days: 10, last_harvest_at: null, last_rows: 0, last_error: "offline" } as any);
  assert.ok(libraryStatus().some((m) => m.source === "at-fuel"));
  const { GET } = await import("../app/api/v1/library/route");
  const body: any = await (await GET()).json();
  assert.ok(!body.sources.some((m: any) => m.source === "at-fuel" || m.source === "au-wa-fuel"));
  assert.ok(body.sources.some((m: any) => m.source === "es-fuel"));
});

test("honesty: an official statistic stores no record count, and history never shows a made-up one (G20261021-PLACEHOLDER-N)", () => {
  const official = (n: number) => ({ area: "ALL", item: "diesel", n, median: 1.45, low: 1.45, high: 1.45, min: 1.45, max: 1.45 });
  // the gate: a real count must reach 5; "no count" passes, because there is no sample to be thin
  assert.equal(passesGate(NO_COUNT), true);
  assert.equal(passesGate(5), true);
  assert.equal(passesGate(4), false);
  // storage: an empty cell, read back as NO_COUNT; a thin real count is still dropped
  writeDaily("gb-desnz-fuel", { date: "2026-10-12", currency: "GBP", unit: "per litre", rows: [official(NO_COUNT), { ...official(3), item: "petrol" }] });
  const file = readFileSync(path.join(dir, "gb-desnz-fuel", "daily", "2026-10.csv"), "utf8").trim().split("\n");
  assert.equal(file.length, 2, "the 3-record row is dropped, the no-count row is kept");
  assert.equal(file[1], "2026-10-12,ALL,diesel,,1.45,1.45,1.45,1.45,1.45", "n is an empty cell, never a number");
  assert.ok(Number.isNaN(readDaily("gb-desnz-fuel", { area: "ALL", item: "diesel", from: "2026-10-01", to: "2026-10-31" })[0].n));
  // an older row that still carries the former placeholder (5) is also returned as null
  writeDaily("gb-desnz-fuel", { date: "2026-10-05", currency: "GBP", unit: "per litre", rows: [official(5)] });
  writeMeta("gb-desnz-fuel", { source: "gb-desnz-fuel", currency: "GBP", unit: "per litre", first_date: "2026-10-05", last_date: "2026-10-12", days: 2, last_harvest_at: null, last_rows: 1, last_ok_at: null, last_error: null });
  const h = runHistory(categoryById("fuel")!, { country: "GB", fuel: "diesel", days: 30 }, {}, new Date("2026-10-13T12:00:00Z"));
  assert.equal(h.series.length, 2);
  assert.ok(h.series.every((r) => r.sample_size === null), "history sample_size is null for old and new rows alike");
  assert.match(String(h.sample_size_note), /null/);
});
