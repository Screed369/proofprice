// Tests for the EIA weekly fuel source. Fixtures are real EIA values (see ./fixtures.ts); xls-sample.xls is a small generated BIFF8 file that exercises the reader (it holds no EIA data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily } from "../../lib/library/store";
import { InputError } from "../../lib/http";
import { INFO, parseWorkbooks, productFor, snapshotOf, toGallon, toLitre, usFuelAnswer, usFuelHistoryKey, usFuelNow, weeklyRows } from "./source";
import { NATIONAL_AREA, resolvePlace } from "./areas";
import { readXls } from "./xls";
import { DIESEL_SHEETS, GASOLINE_SHEETS } from "./fixtures";

const data = parseWorkbooks(GASOLINE_SHEETS, DIESEL_SHEETS);
const day = weeklyRows(data);
const snap = snapshotOf({ date: day.date, rows: day.rows });
const TODAY = new Date("2026-10-14T12:00:00Z");

test("licence quotes EIA's public-domain statement and URL", () => {
  assert.match(INFO.licence, /public domain/);
  assert.equal(INFO.licence_url, "https://www.eia.gov/about/copyrights_reuse.php");
  assert.equal(INFO.price_type, "official_statistic");
});

test("the xls reader reads a BIFF8 workbook (generated sample: 240 rows, text, floats, ints, dates)", () => {
  const sheets = readXls(readFileSync(path.join(__dirname, "xls-sample.xls")));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].rows.length, 241);
  assert.deepEqual(sheets[0].rows[0], ["Date", "Name", "Value", "Int", "Big", "Cents"]);
  assert.deepEqual(sheets[0].rows[1], [46027, "Area 0 Zürich Café", 3, -5000, 123456789, 0]);
  assert.throws(() => readXls(Buffer.from("not an xls")));
});

test("newest week is 2026-10-12 with week-ago and year-ago rows", () => {
  assert.equal(day.date, "2026-10-12");
  const items = new Set(day.rows.filter((r) => r.area === "ALL").map((r) => r.item));
  for (const i of ["regular", "regular@w1", "regular@y1", "diesel", "diesel@y1"]) assert.ok(items.has(i), i);
});

test("unit conversion round-trips EIA's published gallon price", () => {
  for (const v of [4.331, 6.179, 2.585]) assert.equal(toGallon(toLitre(v)), v);
});

test("national regular gasoline answer", () => {
  const a = usFuelAnswer(snap, resolvePlace({}), "regular", { fuel: "petrol95", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 4.331);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.to, "2026-10-12");
  assert.match(a.summary, /4\.331 a gallon/);
  assert.equal((a.extra as any).change_on_week.value, 4.354);
  assert.equal((a.extra as any).change_on_year.value, 3.061);
});

test("California diesel", () => {
  const a = usFuelAnswer(snap, resolvePlace({ area: "California" }), "diesel", { fuel: "diesel", area: "California", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 8.091);
  assert.equal((a.extra as any).area.code, "CA");
});

test("unpublished state falls back to national and says so", () => {
  const a = usFuelAnswer(snap, resolvePlace({ area: "Kansas" }), "regular", { fuel: "petrol95", area: "Kansas", today: TODAY });
  assert.equal(a.price!.value, 4.331);
  assert.match(a.summary, /national average/);
  assert.equal((a.extra as any).area.national_average_used, true);
  const d = usFuelAnswer(snap, resolvePlace({ area: "Texas" }), "diesel", { fuel: "diesel", area: "Texas", today: TODAY });
  assert.match(d.summary, /only for the United States, the PADD regions and California/);
});

test("old data is flagged", () => {
  const a = usFuelAnswer(snap, resolvePlace({}), "regular", { fuel: "petrol95", today: new Date("2026-12-01T00:00:00Z") });
  assert.match(a.summary, /Old data/);
});

test("product selection", () => {
  assert.equal(productFor("petrol95"), "regular");
  assert.equal(productFor("petrol98"), "premium");
  assert.equal(productFor("petrol95", "midgrade"), "midgrade");
  assert.equal(productFor("diesel"), "diesel");
  assert.throws(() => productFor("diesel", "premium"), InputError);
  assert.throws(() => productFor("lpg"), InputError);
});

test("history key points at the published area or the nation", () => {
  assert.equal(usFuelHistoryKey({ fuel: "diesel", area: "Texas" })!.area, NATIONAL_AREA.key);
  assert.equal(usFuelHistoryKey({ fuel: "petrol95", area: "TX" })!.area, "TX");
  assert.equal(usFuelHistoryKey({ fuel: "lpg" }), null);
});

test("usFuelNow reads the library", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "us-fuel-"));
  try {
    writeDaily(INFO.id, { date: day.date, currency: "USD", unit: "per litre", rows: day.rows, note: "test" });
    const a = await usFuelNow({ fuel: "petrol95", today: TODAY });
    assert.equal(a.price!.value, 4.331);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
