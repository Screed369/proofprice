// Fixture: fixtures/fuelprice-sample.json holds real rows copied on 2026-10-16 from
// https://api.data.gov.my/data-catalogue?id=fuelprice&limit=120&sort=-date (3 weeks of 2026, 3 of 2025, level + change rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, API_URL, answerFromRows, changeFrom, myFuel, parseRows } from "./source";

const JSON_ROWS = JSON.parse(readFileSync(new URL("./fixtures/fuelprice-sample.json", import.meta.url), "utf8"));

test("my-fuel: keeps only level rows, newest first", () => {
  const rows = parseRows(JSON_ROWS);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].date, "2026-10-15");
  assert.equal(rows[0].diesel, 5.17);
});

test("my-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseRows({ error: "moved" }), SourceError);
  assert.throws(() => parseRows([{ date: "2026-10-15", series_type: "other" }]), SourceError);
});

test("my-fuel: diesel answer is an official statistic in MYR per litre with week and year change", () => {
  const a = answerFromRows(parseRows(JSON_ROWS), { fuel: "diesel" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "MYR");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.value, 5.17);
  assert.equal(a.period.to, "2026-10-15");
  const x = a.extra as any;
  assert.equal(x.change_on_week.from, "2026-10-08");
  assert.equal(x.change_on_week.percent, -1.9);
  assert.equal(x.change_on_year.from, "2025-10-16");
  assert.ok(x.change_on_year.percent > 70);
  assert.equal(x.subsidised_myr_per_litre.ron95_budi95, 1.99);
  assert.match(a.source.licence, /CC BY 4\.0/);
});

test("my-fuel: petrol95 is RON95, petrol98 says it is RON97, places answered nationally", () => {
  const rows = parseRows(JSON_ROWS);
  assert.equal(answerFromRows(rows, { fuel: "petrol95" }).price!.value, 4.62);
  const a98 = answerFromRows(rows, { fuel: "petrol98", town: "Penang" });
  assert.equal(a98.price!.value, 5.1);
  assert.match(a98.statistic!.note!, /RON97, not RON98/);
  assert.match(a98.statistic!.note!, /Malaysia price/);
  assert.throws(() => answerFromRows(rows, { fuel: "lpg" }), InputError);
});

test("my-fuel: changeFrom needs a week within 4 days", () => {
  const rows = parseRows(JSON_ROWS);
  assert.equal(changeFrom(rows, "diesel", rows[0], 180), null);
});

test("my-fuel: fetch is injected and the registry routes MY to it", async () => {
  const a = await myFuel({ fuel: "diesel" }, async (u) => {
    assert.equal(u, API_URL);
    return JSON_ROWS;
  });
  assert.equal(a.status, "ok");
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(plugin.category, "fuel");
  assert.deepEqual(plugin.countries, ["MY"]);
  assert.ok(categoryById("fuel"));
});
