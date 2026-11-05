// Fixture: fixtures/comparaison-prix-carburants-2026-11-04.csv is the whole real file of
// https://data.public.lu/fr/datasets/r/d3a17cf8-5afc-4bf5-8222-9519e343d29d (fetched 2026-11-05, plain GET, 10 monthly rows Jan-26 to Oct-26).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { findSource } from "../../lib/registry";
import { INFO, harvestRows, luFuel, luFuelHistoryKey, parseMonthLabel, parseMonths } from "./source";

const CSV = readFileSync(new URL("./fixtures/comparaison-prix-carburants-2026-11-04.csv", import.meta.url), "utf8");
const getter = async () => CSV;

test("lu-statec-fuel: parses the real monthly rows", () => {
  const m = parseMonths(CSV);
  assert.equal(m.length, 10);
  const last = m[m.length - 1];
  assert.equal(last.label, "2026-10");
  assert.equal(last.from, "2026-10-01");
  assert.equal(last.to, "2026-10-31");
  assert.equal(last.e10, 1.805);
  assert.equal(last.diesel, 2.066);
  assert.equal(last.lpg, 0.915);
  assert.equal(last.hydrogen, 9.95);
  assert.equal(m[0].label, "2026-01");
});

test("lu-statec-fuel: month labels", () => {
  assert.deepEqual(parseMonthLabel("Feb-28"), { label: "2028-02", from: "2028-02-01", to: "2028-02-29" });
  assert.equal(parseMonthLabel("janv-27")!.label, "2027-01");
  assert.equal(parseMonthLabel("nonsense"), null);
});

test("lu-statec-fuel: E10 answer is an official statistic in EUR per litre with three-month and year change", async () => {
  const a = await luFuel({ fuel: "e10" }, { getter });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 1.805);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-10-01");
  assert.equal(a.period.to, "2026-10-31");
  const x = a.extra as any;
  assert.equal(x.change_on_three_months_earlier.from_month, "2026-07");
  assert.equal(x.change_on_three_months_earlier.change_percent, 5.9);
  assert.equal(x.change_on_year_earlier, null);
  assert.equal(x.other_fuels_same_month.diesel.price_eur, 2.066);
  assert.match(a.summary, /E10 petrol in Luxembourg was 1\.805 EUR per litre/);
  assert.match(a.source.licence, /CC0/);
});

test("lu-statec-fuel: a place gets the national figure and a note; other fuels are input errors", async () => {
  const p = await luFuel({ fuel: "e10", town: "Esch-sur-Alzette" }, { getter });
  assert.equal(p.price!.value, 1.805);
  assert.match(JSON.stringify(p.extra), /Esch-sur-Alzette/);
  const n = await luFuel({ fuel: "e10", area: "Luxembourg" }, { getter });
  assert.ok(!(n.extra as any).place_note);
  await assert.rejects(() => luFuel({ fuel: "diesel" }, { getter }), InputError);
});

test("lu-statec-fuel: empty or foreign-layout file is a source error", async () => {
  await assert.rejects(() => luFuel({ fuel: "e10" }, { getter: async () => "" }), SourceError);
  await assert.rejects(() => luFuel({ fuel: "e10" }, { getter: async () => "a,b\n1,2\n" }), SourceError);
});

test("lu-statec-fuel: harvest stores the newest month dated by its last day, NO_COUNT", () => {
  const h = harvestRows(parseMonths(CSV));
  assert.equal(h.date, "2026-10-31");
  assert.equal(h.currency, "EUR");
  assert.equal(h.rows.length, 1);
  assert.ok(Number.isNaN(h.rows[0].n));
  assert.equal(h.rows[0].median, 1.805);
  assert.deepEqual(luFuelHistoryKey({ fuel: "e10" }), { area: "LU", item: "e10", label: "Luxembourg (national average)" });
  assert.equal(luFuelHistoryKey({ fuel: "diesel" }), null);
});

test("lu-statec-fuel: serves() takes only E10 for LU, never tax=without", async () => {
  const def = (await import("./index")).default;
  assert.equal(def.serves!({ country: "LU", fuel: "e10" }), true);
  assert.equal(def.serves!({ country: "LU", fuel: "diesel" }), false);
  assert.equal(def.serves!({ country: "LU", fuel: "e10", tax: "without" }), false);
  assert.equal(INFO.id, "lu-statec-fuel");
  // platform task: findSource("fuel","LU",{fuel:"e10"}) still picks eu-oil-bulletin (its serves() is true for LU and it sorts first);
  // once eu-oil-bulletin excludes LU+e10, add: assert.equal(findSource(...).info.id, "lu-statec-fuel").
  void findSource;
});
