import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pp-bf-"));
process.env.PROOFPRICE_LIBRARY_DIR = dir;

import { applyBackfill, readMonthly, readHistoryMeta, detailCutoff, MAX_SOURCE_BYTES, totalHistoryBytes } from "../lib/library/backfill";
import { libraryDates, writeDaily, readDaily } from "../lib/library/store";

const today = new Date("2026-10-18T12:00:00Z");
const row = (area: string, item: string, n: number, median: number) => ({ area, item, n, median, low: median - 0.05, high: median + 0.05, min: median - 0.1, max: median + 0.1 });
const res = (periods: { period: string; rows: any[] }[]) => ({ currency: "EUR", unit: "per litre", periods });

test("backfill: monthly rows stored, thin and invalid rows dropped, idempotent", () => {
  const r = res([
    { period: "2020-03", rows: [row("69", "diesel", 40, 1.3), row("01", "diesel", 4, 1.3), row("ALL", "diesel", 400, 1.31)] },
    { period: "2020-04", rows: [row("69", "diesel", 41, 1.1), { ...row("69", "e10", 30, 1.2), median: NaN }, row("12 Rue de la Paix, Lyon, France, long address text here", "x", 9, 1)] },
    { period: "2020-13", rows: [row("69", "diesel", 40, 1.3)] },
  ]);
  const a = applyBackfill("fr-fuel", r, { today });
  assert.equal(a.monthly_rows, 3);
  assert.equal(a.dropped_thin, 1);
  assert.equal(a.dropped_invalid, 1 + 1 + 1);
  const file = path.join(dir, "fr-fuel", "history", "2020.csv");
  const first = readFileSync(file, "utf8");
  applyBackfill("fr-fuel", r, { today });
  assert.equal(readFileSync(file, "utf8"), first);
  assert.deepEqual(readMonthly("fr-fuel", { area: "69", item: "diesel", from: "2020-01-01", to: "2020-12-31" }).map((x) => x.date), ["2020-03", "2020-04"]);
  const meta = readHistoryMeta("fr-fuel")!;
  assert.equal(meta.first_period, "2020-03");
  assert.equal(meta.last_period, "2020-04");
});

test("backfill: days older than 90 days are refused, recent days only when not already harvested", () => {
  assert.equal(detailCutoff(today), "2026-07-20");
  writeDaily("es-fuel", { date: "2026-10-14", currency: "EUR", unit: "per litre", rows: [row("28", "diesel", 60, 1.5)] });
  const daily = path.join(dir, "es-fuel", "daily", "2026-10.csv");
  const before = readFileSync(daily, "utf8");
  const a = applyBackfill("es-fuel", res([
    { period: "2026-01-05", rows: [row("28", "diesel", 60, 1.4)] }, // too detailed
    { period: "2026-10-14", rows: [row("28", "diesel", 60, 9.9)] }, // already held: never replaced
    { period: "2026-10-10", rows: [row("28", "diesel", 60, 1.49)] }, // new recent day: allowed
    { period: "2027-01", rows: [row("28", "diesel", 60, 1.4)] }, // future month
  ]), { today });
  assert.equal(a.skipped_too_detailed, 1);
  assert.equal(a.skipped_held_days, 1);
  assert.equal(a.daily_rows, 1);
  assert.deepEqual(libraryDates("es-fuel"), ["2026-10-10", "2026-10-14"]);
  assert.equal(readDaily("es-fuel", { area: "28", item: "diesel", from: "2026-10-14", to: "2026-10-14" })[0].median, 1.5);
  assert.ok(readFileSync(daily, "utf8").includes(before.split("\n")[1])); // the harvested line is untouched
  assert.equal(existsSync(path.join(dir, "es-fuel", "meta.json")), false); // meta.json belongs to the collector
});

test("backfill: dry run writes nothing; size budget refuses before writing", () => {
  const a = applyBackfill("ie-ppr", res([{ period: "2019-01", rows: [row("Dublin", "all", 50, 300000)] }]), { today, dryRun: true });
  assert.equal(a.monthly_rows, 1);
  assert.equal(existsSync(path.join(dir, "ie-ppr")), false);
  const many: any[] = [];
  for (let m = 1; m <= 12; m++) for (let y = 1990; y < 2026; y++) for (let k = 0; k < 400; k++) many.push({ period: `${y}-${String(m).padStart(2, "0")}`, rows: [row(`area-${k}`, `item-${k}`, 50, 1000 + k)] });
  const total = totalHistoryBytes();
  assert.throws(() => applyBackfill("big-source", res(many), { today }), /Size budget/);
  assert.equal(existsSync(path.join(dir, "big-source")), false);
  assert.equal(totalHistoryBytes(), total);
  assert.ok(MAX_SOURCE_BYTES === 5 * 1024 * 1024);
});

test("backfill: refuses to overwrite a history file with an unexpected header", () => {
  mkdirSync(path.join(dir, "de-smard", "history"), { recursive: true });
  writeFileSync(path.join(dir, "de-smard", "history", "2021.csv"), "something,else\n1,2\n");
  assert.throws(() => applyBackfill("de-smard", res([{ period: "2021-02", rows: [row("DE", "power", 700, 50)] }]), { today }), /unexpected header/);
});
