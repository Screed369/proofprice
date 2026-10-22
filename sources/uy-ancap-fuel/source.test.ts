// Tests for UY fuel (ANCAP maximum prices). Fixtures are REAL rows of the dataset, probed 2026-10-22 (see fixtures.ts).
// Year-earlier and previous-month tests add SYNTHETIC rows (marked) because only the real rows above were proven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_REPLY, OLD_RECORDS } from "./fixtures";
import { API, INFO, uyFuelAnswer, parseQuotes } from "./source";
import manifest from "./index";

const TODAY = new Date("2026-10-22T12:00:00Z");

test("parseQuotes reads the real reply: swapped columns, S/C, asterisks", () => {
  const q = parseQuotes(REAL_REPLY);
  const d = q.find((x) => x.month === "2026-07" && x.product === "GASOIL 10-S");
  assert.equal(d?.value, 67.33); // "GASOIL 10-S *" with the number in "Unidad"
  assert.equal(q.find((x) => x.month === "2026-06" && x.product === "PREMIUM 97 30-S")?.value, 96);
  assert.equal(q.find((x) => x.month === "2026-09" && x.product === "SUPER 95 30-S")?.value, null); // S/C
  assert.equal(q.find((x) => x.product === "QUEROSENO ILUMINANTE")?.value, 67.5);
  assert.equal(parseQuotes({ result: { records: OLD_RECORDS } })[0].value, 73.41);
  assert.throws(() => parseQuotes({}), /unexpected format/);
  assert.throws(() => parseQuotes({ result: { records: [] } }), /no usable price rows/);
});

test("diesel: July 2026 maximum price, skipping the unquoted August and September", () => {
  const a = uyFuelAnswer(parseQuotes(REAL_REPLY), { fuel: "diesel" }, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 67.33);
  assert.equal(a.price?.currency, "UYU");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_pump_price");
  assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-07-31" });
  assert.match(a.statistic?.note ?? "", /no quotation \(S\/C\) for gasoil 10-S diesel in August 2026 and September 2026/);
  assert.match(a.summary, /maximum price/);
  assert.match(a.summary, /not a station price/);
  const x = a.extra as any;
  assert.equal(x.same_month_other_grade.value, 58.68);
  assert.deepEqual(x.months_without_quotation_since, ["2026-08", "2026-09"]);
  assert.equal(x.change_on_previous_quoted_month.value, 70.91);
  assert.equal(x.change_on_previous_quoted_month.change_percent, -5);
});

test("petrol95 and the age note", () => {
  const a = uyFuelAnswer(parseQuotes(REAL_REPLY), { fuel: "petrol95" }, TODAY);
  assert.equal(a.price?.value, 88.67);
  assert.match(a.statistic?.note ?? "", /Old data: the newest quoted month for this fuel is 3 months old/);
  assert.equal((a.extra as any).same_month_other_grade.label, "Premium 97 petrol");
});

test("year-earlier change (SYNTHETIC July 2025 row, arithmetic only)", () => {
  const q = [...parseQuotes(REAL_REPLY), { month: "2025-07", product: "GASOIL 10-S", value: 60 }];
  const a = uyFuelAnswer(q, { fuel: "diesel" }, TODAY);
  assert.equal((a.extra as any).change_on_year_earlier.change_percent, 12.2);
  assert.match(a.summary, /12\.2% higher than a year earlier/);
});

test("an area or postcode gets the national figure and a note, never a made-up local one", () => {
  const a = uyFuelAnswer(parseQuotes(REAL_REPLY), { fuel: "diesel", town: "Montevideo", postcode: "11300" }, TODAY);
  assert.equal(a.status, "ok");
  assert.match(a.statistic?.note ?? "", /no figure by postcode 11300, Montevideo/);
});

test("a fuel with no quotation at all gives no_matches in words; fuels not published are refused", () => {
  const a = uyFuelAnswer([{ month: "2026-09", product: "SUPER 95 30-S", value: null }], { fuel: "petrol95" }, TODAY);
  assert.equal(a.status, "no_matches");
  assert.throws(() => uyFuelAnswer(parseQuotes(REAL_REPLY), { fuel: "lpg" }), /petrol95\) and gasoil 10-S diesel/);
});

test("request URL is ASCII-only (accented names were refused by the portal) and licence/attribution are filled", () => {
  assert.match(API, /^[\x20-\x7e]+$/);
  assert.match(API, /sort=_id%20desc/);
  assert.match(INFO.attribution, /Licencia de Datos Abiertos - Uruguay/);
  assert.match(INFO.attribution, /Converted and aggregated by ProofPrice/);
  assert.deepEqual(manifest.countries, ["UY"]);
  assert.equal(manifest.examples?.[0].params.country, "UY");
});
