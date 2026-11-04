// Tests for the BFE Switzerland reference-price source.
// Fixture: the last rows of the live file https://www.bfe-ogd.ch/ogd60_rmp_monatspreise.csv, copied 2026-11-04 (header + 15 months).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { INFO, chReferenceAnswer, monthFigure, normaliseTech, parseMonthly } from "./source";

const CSV = [
  "Year,Month,Days,Volume_pv_MWh,Price_pv_CHF_MWh,Volume_wasserkraft_MWh,Price_wasserkraft_CHF_MWh,Volume_windenergie_MWh,Price_windenergie_CHF_MWh,Volume_biomasse_MWh,Price_biomasse_CHF_MWh",
  "2025,9,30,300000,70.00,900000,90.00,8000,88.00,130000,86.00", // SYNTHETIC same-month-last-year row to test the year-on-year comparison
  "2026,2,28,185438,97.70,782214,103.24,20182,105.77,141201,104.29",
  "2026,3,31,397071,98.81,783350,123.67,12483,125.54,151116,121.22",
  "2026,4,30,624772,23.01,1085075,84.07,10628,80.77,147014,79.25",
  "2026,5,31,708763,35.81,1299590,95.76,10857,95.80,145638,91.02",
  "2026,6,30,721248,55.88,1366406,97.95,9449,89.57,126301,94.00",
  "2026,7,31,839897,66.82,1086510,110.56,10006,110.12,142746,108.24",
  "2026,8,31,680679,86.94,986501,135.47,9775,137.20,128729,130.61",
  "2026,9,30,546630,112.04,653088,165.29,6228,164.41,123466,159.26",
  "",
].join("\n");

test("licence and type: official statistic, free tier wording", () => {
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /terms_by/);
  assert.match(INFO.attribution, /EPEX SPOT/);
});

test("parse real rows", () => {
  const m = parseMonthly(CSV);
  assert.equal(m.length, 9);
  assert.equal(m[m.length - 1].key, "2026-09");
  assert.equal(m[m.length - 1].prices.hydro, 165.29);
  assert.equal(m[m.length - 1].volumes.wind, 6228);
});

test("a changed layout is reported, not guessed", () => {
  assert.throws(() => parseMonthly("a,b\n1,2\n"), SourceError);
});

test("volume-weighted all-technology figure for Sept 2026", () => {
  const m = parseMonthly(CSV).find((x) => x.key === "2026-09")!;
  const exp = (112.04 * 546630 + 165.29 * 653088 + 164.41 * 6228 + 159.26 * 123466) / (546630 + 653088 + 6228 + 123466);
  assert.ok(Math.abs((monthFigure(m, "all") as number) - exp) < 1e-9);
});

test("answer: newest month, CHF per MWh, statistic, no sample size", () => {
  const a = chReferenceAnswer(parseMonthly(CSV), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "CHF");
  assert.equal(a.price?.unit, "per MWh");
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  const x = a.extra as any;
  assert.equal(x.month, "2026-09");
  assert.equal(x.previous_month.month, "2026-08");
  assert.equal(x.same_month_last_year.month, "2025-09");
  assert.equal(x.last_12_months.length, 9);
});

test("single technology: hydro Sept 2026", () => {
  const a = chReferenceAnswer(parseMonthly(CSV), { technology: "Hydro" });
  assert.equal(a.price?.value, 165.29);
  assert.equal(a.price?.min, 84.07);
  assert.equal(a.price?.max, 165.29);
});

test("input checks name the valid values", () => {
  assert.equal(normaliseTech("solar"), "pv");
  assert.throws(() => normaliseTech("coal"), InputError);
  assert.throws(() => chReferenceAnswer(parseMonthly(CSV), { commodity: "gas" }), /electricity/);
});

test("no data gives no_matches, never a made-up number", () => {
  const a = chReferenceAnswer([], {});
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});
