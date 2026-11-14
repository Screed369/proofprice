import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTable52, parseSetting, parseAge, findPlace, valueFor, careAnswer, isCareService } from "./source";
import { TABLE_52_ROWS } from "./fixtures";

// Fixture: real Table_52 rows from the DHSC data tables (ODS), read 14 Nov 2026. Report headline: England residential and nursing 2024-25 = 1,185.55.
const table = parseTable52(TABLE_52_ROWS);

test("England headline matches the report text (1,185.55)", () => {
  const a = careAnswer({ table, service: "care home" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "GBP");
  assert.ok(Math.abs((a.price?.value ?? 0) - 1185.55) < 0.5);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.from, "2024-04-01");
  assert.equal(a.period.to, "2025-03-31");
  assert.equal(a.statistic?.reference_period, "2024-25");
  assert.match(a.source.licence, /Open Government Licence/);
});

test("settings and ages are read from the words", () => {
  assert.equal(parseSetting("nursing care"), "Nursing");
  assert.equal(parseSetting("residential care"), "Residential");
  assert.equal(parseSetting("care home"), "Residential and nursing");
  assert.equal(parseAge("nursing home for over 65s"), "65 and over");
  assert.equal(parseAge("care for adults 18 to 64"), "18 to 64");
  assert.equal(parseAge("care home"), "Total");
  assert.equal(isCareService("MRI scan"), false);
});

test("nursing 65 and over in the North East (2024-25 and the year before)", () => {
  const ne = findPlace(table, "North East")!;
  assert.equal(ne.kind, "region");
  const nur = valueFor(table, ne, "Nursing", "65 and over");
  assert.equal(nur.latest?.year, "2024 to 2025");
  assert.ok(Math.abs(nur.latest!.value - 911.14) < 0.01);
  assert.ok(Math.abs(nur.previous!.value - 918.99) < 0.01);
});

test("a council by name, case and punctuation ignored", () => {
  assert.equal(findPlace(table, "gateshead")?.name, "Gateshead");
  assert.equal(findPlace(table, "Newcastle upon Tyne")?.kind, "council");
  assert.equal(findPlace(table, "Atlantis"), null);
  const a = careAnswer({ table, service: "nursing care", state: "Gateshead" });
  assert.equal(a.status, "ok");
  assert.ok(a.summary.includes("Gateshead"));
  assert.ok((a.extra as any).england_average_gbp_per_week > 1000);
});

test("an unknown area is no_matches, not a made-up England figure", () => {
  const a = careAnswer({ table, service: "care home", state: "Atlantis" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("other medical services are refused with a helpful message", () => {
  assert.throws(() => careAnswer({ table, service: "knee replacement" }), /care home/);
});

test("a changed layout is an error, not a wrong answer", () => {
  assert.throws(() => parseTable52([["Something else"]]), /layout changed/);
  assert.throws(() => parseTable52(TABLE_52_ROWS.slice(0, 10)), /layout changed/);
});
