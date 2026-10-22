// Tests for NO fuel (SSB table 09654). Fixture fixtures/t09654.json: the REAL JSON-stat2 reply (top(14) months to 2026M09), captured
// 2026-10-22 18:45 UTC through the GitHub-hosted probe. Only the "no data" and big-move cases edit a copy of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, URL_RECENT, harvestRows, monthKey, noFuelAnswer, noFuelHarvest, noFuelHistoryKey, noFuelNow, parseMonths } from "./source";
import manifest from "./index";
import { NO_COUNT } from "../../lib/stats";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t09654.json", import.meta.url), "utf8"));
const TODAY = new Date("2026-10-22T12:00:00Z");

test("parseMonths reads 14 months, newest first, both fuels", () => {
  const { months, table } = parseMonths(FIX);
  assert.equal(months.length, 14);
  assert.equal(months[0].month, "2026-09");
  assert.equal(months[0].petrol95, 26.18);
  assert.equal(months[0].diesel, 27.52);
  assert.equal(months[1].diesel, 21.48);
  assert.equal(months[13].month, "2025-08");
  assert.equal(months[13].petrol95, 21.17);
  assert.equal(table.updated, "2026-10-21T06:00:00Z");
  assert.equal(monthKey("2026M09"), "2026-09");
  assert.equal(monthKey("2026"), null);
});

test("a changed layout is refused in plain words", () => {
  assert.throws(() => parseMonths({ ...FIX, id: ["Other", "ContentsCode", "Tid"], dimension: { ...FIX.dimension, Other: FIX.dimension.PetroleumProd } }), /changed the layout/);
  assert.throws(() => parseMonths({}), /Unexpected response|not a JSON-stat/);
});

test("diesel: the SSB average for September 2026 as an official statistic with no sample size", () => {
  const { months, table } = parseMonths(FIX);
  const a = noFuelAnswer(months, { fuel: "diesel" }, TODAY, table.updated);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 27.52);
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic?.reference_period, "2026-09");
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /not a live pump price/);
  assert.match(JSON.stringify(a), /Statistics Norway \(SSB\)/);
  const x = a.extra as any;
  assert.equal(x.other_fuels_same_month[0].value, 26.18);
  assert.equal(x.change_on_previous_month.value, 21.48);
  assert.equal(x.change_on_previous_month.change_percent, 28.1);
  assert.equal(x.change_on_year_earlier.reference_month, "2025-09");
  assert.equal(x.change_on_year_earlier.value, 20.27);
});

test("a +28% month is flagged in the note, not hidden", () => {
  const { months } = parseMonths(FIX);
  const a = noFuelAnswer(months, { fuel: "diesel" }, TODAY);
  assert.match(JSON.stringify(a), /Large move: diesel was 28\.1% higher than in August 2026/);
  const calm = noFuelAnswer(months.slice(1), { fuel: "diesel" }, TODAY); // August 2026 vs July 2026: +6%
  assert.doesNotMatch(JSON.stringify(calm), /Large move/);
});

test("petrol95 and the year-earlier comparison", () => {
  const { months } = parseMonths(FIX);
  const a = noFuelAnswer(months, { fuel: "petrol95" }, TODAY);
  assert.equal(a.price?.value, 26.18);
  assert.equal((a.extra as any).change_on_year_earlier.value, 20.78);
});

test("an area or postcode is answered with the national figure and says so", () => {
  const { months } = parseMonths(FIX);
  const a = noFuelAnswer(months, { fuel: "diesel", town: "Oslo", postcode: "0150" }, TODAY);
  assert.equal(a.price?.value, 27.52);
  assert.match(JSON.stringify(a), /national average for Norway/);
  assert.equal((a.extra as any).place_note.includes("Oslo"), true);
});

test("old data is labelled; unsupported fuels are refused", () => {
  const { months } = parseMonths(FIX);
  assert.match(JSON.stringify(noFuelAnswer(months, { fuel: "diesel" }, new Date("2027-02-01T00:00:00Z"))), /Old data/);
  assert.throws(() => noFuelAnswer(months, { fuel: "lpg" }, TODAY), /petrol95\) and diesel only/);
});

test("no usable month: a plain answer, not a made-up figure", () => {
  const a = noFuelAnswer([], { fuel: "diesel" }, TODAY);
  assert.notEqual(a.status, "ok");
  assert.equal(a.price, null);
});

test("noFuelNow asks SSB once for the 14-month URL", async () => {
  const calls: string[] = [];
  const a = await noFuelNow({ fuel: "diesel" }, TODAY, async (u) => (calls.push(u), FIX));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], URL_RECENT);
  assert.match(URL_RECENT, /valueCodes%5BPetroleumProd%5D=031,035/);
  assert.match(URL_RECENT, /valueCodes%5BContentsCode%5D=Priser/);
  assert.equal(a.price?.value, 27.52);
});

test("harvest: two rows dated the end of the reference month, n NO_COUNT", async () => {
  const h = await noFuelHarvest(async () => FIX);
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "NOK");
  assert.equal(h.unit, "per litre");
  assert.deepEqual(h.rows.map((r) => [r.area, r.item, r.median, r.n]), [["NO", "petrol95", 26.18, NO_COUNT], ["NO", "diesel", 27.52, NO_COUNT]]);
  assert.throws(() => harvestRows([]), /no months/);
  assert.deepEqual(noFuelHistoryKey({ fuel: "diesel" }), { area: "NO", item: "diesel", label: "Norway (national average)" });
  assert.equal(noFuelHistoryKey({ fuel: "lpg" }), null);
});

test("manifest: fuel category, Norway only, licence and attribution present", () => {
  assert.equal(manifest.category, "fuel");
  assert.deepEqual(manifest.countries, ["NO"]);
  assert.equal(INFO.licence_url, "https://www.ssb.no/en/diverse/lisens");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.ok(manifest.examples[0].params.country === "NO");
});
