// Tests for UY fuel (ANCAP maximum prices). Fixtures are REAL rows of the dataset, probed 2026-10-22 (see fixtures.ts).
// Year-earlier and previous-month tests add SYNTHETIC rows (marked) because only the real rows above were proven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_REPLY, OLD_RECORDS } from "./fixtures";
import { API, INFO, uyFuelAnswer, parseQuotes, uyHarvestRows, uyFuelHistoryKey } from "./source";
import { NO_COUNT } from "../../lib/stats";
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

test("harvest stores the newest month quoted for both pump fuels (July 2026), national, no record count", () => {
  const h = uyHarvestRows(parseQuotes(REAL_REPLY));
  assert.equal(h.date, "2026-07-31"); // Aug and Sep are S/C for every pump fuel
  assert.equal(h.currency, "UYU");
  assert.equal(h.unit, "per litre");
  assert.deepEqual(h.rows.map((r) => [r.area, r.item, r.median]), [["UY", "petrol95", 88.67], ["UY", "diesel", 67.33]]);
  assert.ok(h.rows.every((r) => Number.isNaN(r.n) && Number.isNaN(NO_COUNT) && r.low === r.median && r.max === r.median));
  assert.throws(() => uyHarvestRows(parseQuotes({ result: { records: [{ Ano: "2026", Mes: "9", Producto: "SUPER 95 30-S", Unidad: "S/C", Valor: "S/C" }, { Ano: "2026", Mes: "9", Producto: "QUEROSENO ILUMINANTE", Unidad: "67,5", Valor: "$/lt" }] } })), /no month with a quoted/);
});

test("historyKey maps the two askable fuels to the national library rows, nothing else", () => {
  assert.deepEqual(uyFuelHistoryKey({ fuel: "diesel" }), { area: "UY", item: "diesel", label: "Uruguay (national maximum price)" });
  assert.equal(uyFuelHistoryKey({ fuel: "petrol95" })?.area, "UY");
  assert.equal(uyFuelHistoryKey({ fuel: "lpg" }), null);
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
});
