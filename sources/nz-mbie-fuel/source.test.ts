// Fixture: fixtures/weekly-table-sample.csv holds real rows copied on 2026-10-14 from MBIE's weekly-table.csv
// (header, a 2004 week, 2025w41, 2026w26/27/40/41 and a non-price row), in the live layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromPoints, changeFrom, nzFuel, parseWeekly, CSV_URL } from "./source";

const CSV = readFileSync(new URL("./fixtures/weekly-table-sample.csv", import.meta.url), "utf8");

test("nz-mbie-fuel: parses only the adjusted retail price rows, oldest first", () => {
  const pts = parseWeekly(CSV);
  assert.equal(pts.length, 18); // 6 weeks x 3 fuels (the Board price and crude rows are skipped)
  assert.equal(pts[0].date, "2004-04-23");
  const last = pts[pts.length - 1];
  assert.equal(last.week, "2026w41");
  assert.equal(last.status, "Provisional");
});

test("nz-mbie-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseWeekly("<html>moved</html>"), SourceError);
});

test("nz-mbie-fuel: diesel answer is an official statistic in NZD per litre with week and year change", () => {
  const a = answerFromPoints(parseWeekly(CSV), { fuel: "diesel" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "NZD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.value, 3.209);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.period.to, "2026-10-09");
  const x = a.extra as any;
  assert.equal(x.change_on_week.from, "2026-10-02");
  assert.equal(x.change_on_week.percent, 1.2);
  assert.equal(x.change_on_year.from, "2025-10-10");
  assert.ok(x.change_on_year.percent > 60);
  assert.ok(x.other_fuels.regular_petrol_91.price_nzd_per_litre > 3.4);
  assert.match(a.summary, /provisional/);
  assert.match(a.source.licence, /Creative Commons Attribution 4\.0/);
});

test("nz-mbie-fuel: petrol95 uses premium 95R, petrol98 says so, places are answered nationally", () => {
  const pts = parseWeekly(CSV);
  assert.equal(answerFromPoints(pts, { fuel: "petrol95" }).price!.value, 3.66);
  const a98 = answerFromPoints(pts, { fuel: "petrol98", town: "Auckland" });
  assert.match(a98.statistic!.note!, /no 98 series/);
  assert.match(a98.statistic!.note!, /national/);
  assert.throws(() => answerFromPoints(pts, { fuel: "lpg" }), InputError);
});

test("nz-mbie-fuel: changeFrom needs a week within 4 days", () => {
  const pts = parseWeekly(CSV).filter((p) => p.fuel === "Diesel");
  const latest = pts[pts.length - 1];
  assert.equal(changeFrom(pts, latest, 180), null);
});

test("nz-mbie-fuel: fetch is injected and the registry routes NZ to it", async () => {
  const a = await nzFuel({ fuel: "diesel" }, async (u) => {
    assert.equal(u, CSV_URL);
    return CSV;
  });
  assert.equal(a.status, "ok");
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(plugin.category, "fuel");
  assert.deepEqual(plugin.countries, ["NZ"]);
  assert.ok(categoryById("fuel"));
  assert.equal(typeof runCategory, "function");
});
