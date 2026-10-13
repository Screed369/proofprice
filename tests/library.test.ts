import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateDaily } from "../lib/library/aggregate";
import { csvToRows, libraryDates, readDaily, rowsToCsv, writeDaily, writeMeta, libraryStatus } from "../lib/library/store";
import { categoryById, runHistory } from "../lib/registry";

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
  assert.throws(() => runHistory(categoryById("home-sales")!, { country: "GB", town: "Bristol" }), /daily history/);
});
