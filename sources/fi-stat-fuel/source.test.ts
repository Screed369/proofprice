// Tests for FI fuel (Statistics Finland table 12ge). Fixture fixtures/t12ge.json: the REAL JSON-stat2 reply to the POST in query()
// (14 months to 2026M06, both fuels), captured 2026-10-30 12:50 UTC from pxdata.stat.fi. Only the layout and no-data cases edit a copy of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API, INFO, fiFuelAnswer, fiFuelHarvest, fiFuelHistoryKey, fiFuelNow, harvestRows, monthKey, parseMonths, query } from "./source";
import manifest from "./index";
import { NO_COUNT } from "../../lib/stats";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t12ge.json", import.meta.url), "utf8"));
const TODAY = new Date("2026-10-30T12:00:00Z");
const post = async () => FIX;

test("query asks for the newest 14 months, both fuels, price only", () => {
  const q = query();
  assert.deepEqual(q.query[0], { code: "timeperiod_m", selection: { filter: "top", values: ["14"] } });
  assert.deepEqual(q.query[1].selection.values, ["A", "B"]);
  assert.deepEqual(q.query[2].selection.values, ["hinta"]);
  assert.equal(q.response.format, "json-stat2");
  assert.match(API, /StatFin\/ehi\/12ge\.px$/);
});

test("parseMonths reads 14 months newest first and converts cents to euro", () => {
  const { months, table } = parseMonths(FIX);
  assert.equal(months.length, 14);
  assert.equal(months[0].month, "2026-06");
  assert.equal(months[0].petrol95, 2.09);
  assert.equal(months[0].diesel, 2.15);
  assert.equal(months[1].diesel, 2.26);
  assert.equal(months[13].month, "2025-05");
  assert.equal(months[13].petrol95, 1.75);
  assert.equal(table.updated, "2026-09-24T05:00:00Z");
  assert.equal(monthKey("2026M06"), "2026-06");
  assert.equal(monthKey("2026"), null);
});

test("a changed layout is refused in plain words", () => {
  const { energia_22_20200205: fuelDim, ...rest } = FIX.dimension;
  assert.throws(() => parseMonths({ ...FIX, id: ["timeperiod_m", "Other", "contentscode"], dimension: { ...rest, Other: fuelDim } }), /changed the layout/);
  assert.throws(() => parseMonths({}), /Unexpected response|not a JSON-stat/);
});

test("diesel: the Statistics Finland average for June 2026 as an official statistic with no sample size", () => {
  const { months, table } = parseMonths(FIX);
  const a = fiFuelAnswer(months, { fuel: "diesel" }, TODAY, table.updated);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.15);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(a.statistic?.reference_period, "2026-06");
  assert.match(a.summary, /June 2026/);
  assert.match(a.summary, /not a live pump price/);
  assert.match(JSON.stringify(a), /Statistics Finland/);
  const x = a.extra as any;
  assert.equal(x.other_fuels_same_month[0].value, 2.09);
  assert.equal(x.change_on_previous_month.value, 2.26);
  assert.equal(x.change_on_previous_month.change_percent, -4.9);
  assert.equal(x.change_on_year_earlier.reference_month, "2025-06");
  assert.equal(x.change_on_year_earlier.value, 1.63);
  assert.equal(x.change_on_year_earlier.change_percent, 31.9);
});

test("petrol95 answers from its own series", () => {
  const { months } = parseMonths(FIX);
  const a = fiFuelAnswer(months, { fuel: "petrol95" }, TODAY);
  assert.equal(a.price?.value, 2.09);
  assert.equal((a.extra as any).change_on_year_earlier.value, 1.74);
});

test("a +15% month is flagged in the note, not hidden (diesel March 2026 vs February)", () => {
  const { months } = parseMonths(FIX);
  const a = fiFuelAnswer(months.filter((m) => m.month <= "2026-03"), { fuel: "diesel" }, new Date("2026-06-30T00:00:00Z"));
  assert.equal(a.price?.value, 2.08);
  assert.match(JSON.stringify(a), /Large move: diesel was 15\.6% higher than in February 2026/);
});

test("a place is not used and the answer says so", () => {
  const { months } = parseMonths(FIX);
  const a = fiFuelAnswer(months, { fuel: "diesel", town: "Helsinki", postcode: "00100" }, TODAY);
  assert.match(a.summary + JSON.stringify(a.extra), /national average/i);
  assert.match(JSON.stringify(a), /Statistics Finland publishes no figure by postcode 00100, Helsinki/);
});

test("unsupported fuels are refused in plain words", async () => {
  const { months } = parseMonths(FIX);
  assert.throws(() => fiFuelAnswer(months, { fuel: "lpg" }), /petrol95\) and diesel only/);
  await assert.rejects(() => fiFuelNow({ fuel: "e85" }, TODAY, post), /diesel only/);
});

test("no usable month gives a plain no-data answer", () => {
  const a = fiFuelAnswer([{ month: "2026-06", petrol95: 2.09, diesel: null }], { fuel: "diesel" }, TODAY);
  assert.equal(a.price, null);
  assert.match(a.summary, /publishes no recent national average/);
});

test("the newest-month answer works end to end with an injected POST", async () => {
  const a = await fiFuelNow({ fuel: "diesel", baseUrl: "https://proofprice.com" }, TODAY, post);
  assert.equal(a.price?.value, 2.15);
  assert.equal((a.source as any).id, "fi-stat-fuel");
});

test("harvest stores the newest month, one row per fuel, with no made-up count", async () => {
  const h = harvestRows(parseMonths(FIX).months);
  assert.equal(h.date, "2026-06-30");
  assert.equal(h.currency, "EUR");
  assert.equal(h.unit, "per litre");
  assert.deepEqual(h.rows.map((r) => [r.area, r.item, r.median, r.n]), [["FI", "petrol95", 2.09, NO_COUNT], ["FI", "diesel", 2.15, NO_COUNT]]);
  const viaPost = await fiFuelHarvest(post);
  assert.equal(viaPost.rows.length, 2);
  assert.deepEqual(fiFuelHistoryKey({ fuel: "diesel" }), { area: "FI", item: "diesel", label: "Finland (national average)" });
  assert.equal(fiFuelHistoryKey({ fuel: "lpg" }), null);
});

test("manifest: licence, attribution and the routing hook", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.attribution, /Source: Statistics Finland/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.deepEqual(manifest.countries, ["FI"]);
  assert.equal(manifest.serves?.({ country: "FI", fuel: "diesel" }), true);
  assert.equal(manifest.serves?.({ country: "FI", fuel: "lpg" }), false);
  assert.equal(manifest.serves?.({ country: "SE", fuel: "diesel" }), false);
});
