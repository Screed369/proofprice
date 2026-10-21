// Fixture: the whole CSO table CCA12 as returned live on 2026-10-14 (cca12.fixture.csv, 81 data rows, UTF-8 with BOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { InputError, SourceError } from "../../lib/http";
import { ieAnswer, ieChildcare, parseCca12, regionFor } from "./source";

const CSV = readFileSync(path.join(__dirname, "cca12.fixture.csv"), "utf8");
const NOW = new Date("2026-10-14T12:00:00Z");

test("parse: all 81 rows of the real table", () => {
  const rows = parseCca12(CSV);
  assert.equal(rows.length, 81);
  assert.deepEqual(rows[2], { region: "State", group: "Pre-School children", statistic: "CCA12C03", year: "2016", value: 118 });
  assert.throws(() => parseCca12(CSV.split("\n").slice(0, 10).join("\n")), (e: any) => e instanceof SourceError && /Only \d+ usable rows/.test(e.message));
});

test("places: counties, cities and regions map to the CSO regions; unknown places are refused", () => {
  assert.equal(regionFor("Dublin").region, "Dublin");
  assert.equal(regionFor("County Cork").region, "South-West");
  assert.equal(regionFor("Co. Mayo").region, "West");
  assert.equal(regionFor("Galway City").region, "West");
  assert.equal(regionFor("Mid-West").viaPlace, null);
  assert.equal(regionFor("Ireland").region, "State");
  assert.equal(regionFor(undefined).region, "State");
  assert.throws(() => regionFor("Paris"), (e: any) => e instanceof InputError && /Give an Irish county/.test(e.message));
});

test("Dublin: the published 2016 average weekly cost, flagged as ten years old", () => {
  const a = ieAnswer(parseCca12(CSV), { area: "Dublin" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 125);
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per week");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic?.reference_period, "2016");
  assert.match(a.summary, /In 2016, 10 years ago, households in the Dublin region/);
  assert.match(a.statistic?.note ?? "", /10 years old/);
  assert.match(a.source.licence, /CC BY 4\.0|Creative Commons Attribution 4\.0/);
  assert.equal((a.extra as any).region, "Dublin");
});

test("age groups, county via region, and ignored parameters", () => {
  const rows = parseCca12(CSV);
  assert.equal(ieAnswer(rows, { area: "County Cork", age_group: "school-age" }, NOW).price?.value, 75);
  const pre = ieAnswer(rows, { area: "Cork", age_group: "infant", care_type: "centre", hours: "full-time" }, NOW);
  assert.equal(pre.price?.value, 117);
  assert.match(pre.statistic?.note ?? "", /Cork is in the South-West region/);
  assert.match(pre.statistic?.note ?? "", /care_type was ignored/);
  assert.match(pre.statistic?.note ?? "", /hours was ignored/);
  assert.match(pre.statistic?.note ?? "", /no infant figure/);
  assert.equal(ieAnswer(rows, {}, NOW).price?.value, 96);
});

test("ieChildcare loads the table through the supplied loader", async () => {
  const a = await ieChildcare({ area: "Dublin" }, NOW, async () => CSV);
  assert.equal(a.price?.value, 125);
  await assert.rejects(ieChildcare({ area: "Dublin" }, NOW, async () => "x"), SourceError);
});

test("2016 data is more than five years old, so confidence is low", () => {
  const a = ieAnswer(parseCca12(CSV), { area: "Dublin" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.confidence, "low");
});
