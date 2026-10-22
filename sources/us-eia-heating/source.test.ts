// Tests for the EIA heating oil and propane source. Fixtures: see ./fixtures.ts (heating oil real, propane and year-earlier weeks synthetic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily } from "../../lib/library/store";
import { normaliseFuel } from "../../lib/fuels";
import { INFO, parseSeries, snapshotOf, usHeatingAnswer, usHeatingHistoryKey, usHeatingNow, weeklyRows } from "./source";
import { HEATING_OIL_SHEETS, PROPANE_SHEETS } from "./fixtures";
import usHeating from "./index";
import usFuel from "../us-eia-fuel/index";

const oil = parseSeries(HEATING_OIL_SHEETS, "heating_oil");
const propane = parseSeries(PROPANE_SHEETS, "propane");
const day = weeklyRows({ heating_oil: oil, propane });
const snap = snapshotOf({ date: day.date, rows: day.rows });
const TODAY = new Date("1996-11-14T12:00:00Z");

test("licence quotes EIA's public-domain statement", () => {
  assert.match(INFO.licence, /public domain/);
  assert.equal(INFO.licence_url, "https://www.eia.gov/about/copyrights_reuse.php");
  assert.equal(INFO.price_type, "official_statistic");
});

test("parses the weekly series by its series key", () => {
  assert.equal(oil.size, 6);
  assert.equal(oil.get("1996-11-11"), 1.124);
  assert.equal(propane.get("1996-11-11"), 1.35);
  assert.throws(() => parseSeries(PROPANE_SHEETS, "heating_oil"), /no sheet with series/);
});

test("newest common week with week-ago and year-ago rows (per litre)", () => {
  assert.equal(day.date, "1996-11-11");
  const items = day.rows.map((r) => r.item);
  for (const i of ["heating_oil", "heating_oil@w1", "propane", "propane@w1", "propane@y1"]) assert.ok(items.includes(i), i);
});

test("heating oil national answer", () => {
  const a = usHeatingAnswer(snap, "heating_oil", { fuel: "heating_oil", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1.124);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.to, "1996-11-11");
  assert.match(a.summary, /1\.124 a gallon/);
  assert.equal((a.extra as any).change_on_week.value, 1.126);
  assert.equal((a.extra as any).change_on_year.value, 1.12);
  assert.match(a.source.attribution, /U\.S\. Energy Information Administration \(Nov 1996\)/);
});

test("a place is answered with the national average and says so", () => {
  const a = usHeatingAnswer(snap, "propane", { fuel: "propane", town: "Boston", today: TODAY });
  assert.equal(a.price!.value, 1.35);
  assert.match(a.summary, /national average/);
  assert.equal((a.extra as any).area.national_average_used, true);
});

test("out of season the answer says the data is old", () => {
  const a = usHeatingAnswer(snap, "heating_oil", { fuel: "heating_oil", today: new Date("1997-07-01T00:00:00Z") });
  assert.match(a.summary, /Old data/);
  assert.match(a.summary, /October to March/);
});

test("fuel names and routing: heating oil and propane go here, gasoline and diesel stay with us-eia-fuel", () => {
  assert.equal(normaliseFuel("heating_oil"), "heating_oil");
  assert.equal(normaliseFuel("Heating Oil"), "heating_oil");
  assert.equal(normaliseFuel("propane"), "propane");
  for (const fuel of ["heating_oil", "propane"]) {
    assert.equal(usHeating.serves!({ country: "US", fuel }), true);
    assert.equal(usFuel.serves!({ country: "US", fuel }), false);
  }
  for (const fuel of ["diesel", "petrol95", "petrol98"]) {
    assert.equal(usHeating.serves!({ country: "US", fuel }), false);
    assert.equal(usFuel.serves!({ country: "US", fuel }), true);
  }
});

test("history key", () => {
  assert.deepEqual(usHeatingHistoryKey({ fuel: "propane" }), { area: "ALL", item: "propane", label: "United States" });
  assert.equal(usHeatingHistoryKey({ fuel: "diesel" }), null);
});

test("usHeatingNow reads the library", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "us-heating-"));
  try {
    writeDaily(INFO.id, { date: day.date, currency: "USD", unit: "per litre", rows: day.rows, note: "test" });
    const a = await usHeatingNow({ fuel: "propane", today: TODAY });
    assert.equal(a.price!.value, 1.35);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
