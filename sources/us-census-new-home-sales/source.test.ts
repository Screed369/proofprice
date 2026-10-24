import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, findSource } from "../../lib/registry";
import { NO_COUNT } from "../../lib/stats";
import { makeXlsx } from "../../tests/helpers/make-zip";
import {
  FILE_URL, HARVEST_ITEM, INFO, changePercent, harvestFrom, isNationalRequest, monthEnd, monthShift, monthWords, nrsAnswer, parseNrs, readLatest,
  usNewHomeHistoryKey, usNewHomeSales,
} from "./source";

// Layout checked live on 2026-10-24 through the Probe workflow (https://www.census.gov/construction/nrs/xls/price_cust.xlsx, last modified 24 Sep 2026):
// sheet "Annual": title rows, "Year | United States", "| Median sales price | Average sales price", then Year|median|average rows, then "Footnotes:";
// sheet "Monthly": same, first column an Excel date serial (23012 = 1963-01-01), early averages the text "(NA)".
// The annual rows and the first monthly rows below are copied from that probe; the 2025-2026 monthly rows keep the layout and are test values
// (the real newest rows are read live by the preview check, not pinned here).
const ANNUAL: (string | number | null)[][] = [
  ["Sales Price of New Privately-Owned Houses Sold"], ["(Dollars)"], ["Annual"], ["Year", "United States"], [null, "Median sales price", "Average sales price"],
  [2021, 383500, 458300], [2022, 434500, 521500], [2023, 428600, 514000], [2024, 420300, 514500], [2025, 417400, 523800],
  ["Footnotes:"], ["NA = Not Available"],
];
// 2025-07-01 = 45839 ... one row per month to 2026-08-01 = 46235
const serial = (y: number, m: number) => Math.round(Date.UTC(y, m - 1, 1) / 86400000) + 25569;
const MONTHLY: (string | number | null)[][] = [
  ["Sales Price of New Privately-Owned Houses Sold"], ["(Dollars)"], ["Monthly"], ["Month", "United States"], [null, "Median sales price", "Average sales price"],
  [23012, 17200, "(NA)"], [23043, 17700, "(NA)"],
];
const TEST_MEDIANS = [400000, 404000, 410000, 405000, 398000, 402000, 399000, 401000, 397000, 396000, 403000, 406000, 408000, 412000]; // 2025-07 .. 2026-08
for (let i = 0; i < TEST_MEDIANS.length; i++) {
  const t = 2025 * 12 + 6 + i;
  MONTHLY.push([serial(Math.floor(t / 12), (t % 12) + 1), TEST_MEDIANS[i], TEST_MEDIANS[i] + 100000]);
}
MONTHLY.push(["Footnotes:"], ["NA = Not Available"]);
const workbook = (monthly = MONTHLY, annual = ANNUAL) => makeXlsx({ Annual: annual, Monthly: monthly });

test("serial helper matches the probe: 23012 is 1963-01-01", () => {
  assert.equal(serial(1963, 1), 23012);
});

test("info: Census, CC0, official statistic, honest limits", () => {
  assert.equal(INFO.id, "us-census-new-home-sales");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /zero\/1\.0/);
  assert.match(INFO.attribution, /U\.S\. Census Bureau, New Residential Sales/);
  assert.match(INFO.attribution, /not an endorsement/);
  assert.match(INFO.limits, /New houses only/);
  assert.equal(FILE_URL, "https://www.census.gov/construction/nrs/xls/price_cust.xlsx");
});

test("parseNrs reads both sheets, skips footnotes, turns (NA) into null", () => {
  const d = parseNrs(workbook());
  assert.equal(d.annual.length, 5);
  assert.deepEqual(d.annual[4], { period: "2025", median: 417400, average: 523800 });
  assert.deepEqual(d.monthly[0], { period: "1963-01", median: 17200, average: null });
  assert.equal(d.monthly[d.monthly.length - 1].period, "2026-08");
});

test("parseNrs says plainly when the layout changed", () => {
  assert.throws(() => parseNrs(makeXlsx({ Sheet1: [["x"]] })), (e: any) => e instanceof SourceError && /needs updating/.test(e.message));
  assert.throws(() => parseNrs(makeXlsx({ Annual: [["nothing"]], Monthly: [["nothing"]] })), (e: any) => e instanceof SourceError && /Median sales price/.test(e.message));
});

test("readLatest: newest month, previous month, year earlier, last full year", () => {
  const r = readLatest(parseNrs(workbook()));
  assert.equal(r.latest.period, "2026-08");
  assert.equal(r.latest.median, 412000);
  assert.equal(r.previous?.period, "2026-07");
  assert.equal(r.yearEarlier?.period, "2025-08");
  assert.equal(r.lastYear?.period, "2025");
  assert.equal(r.series.length, 12);
});

test("readLatest ignores a trailing month without a published median", () => {
  const rows = [...MONTHLY.slice(0, -2), [serial(2026, 9), "(NA)", "(NA)"], ["Footnotes:"]];
  assert.equal(readLatest(parseNrs(workbook(rows as any))).latest.period, "2026-08");
});

test("month helpers", () => {
  assert.equal(monthShift("2026-01", -1), "2025-12");
  assert.equal(monthShift("2026-08", -12), "2025-08");
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthWords("2026-08"), "August 2026");
  assert.equal(changePercent(412000, 400000), 3);
});

test("answer: a statistic with sample_size null, period, changes, licence and a plain 'new houses, national' note", async () => {
  const a = await usNewHomeSales({ property_type: "new", baseUrl: "https://proofprice.com" }, async () => ({ data: parseNrs(workbook()), publishedAt: "2026-09-24" }));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 412000);
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.sample_size, null);
  assert.equal(a.source.id, "us-census-new-home-sales");
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.equal(a.period.from, "2026-08-01");
  assert.equal(a.period.to, "2026-08-31");
  assert.match(a.summary, /new houses sold in the United States in August 2026 was US\$412,000/);
  assert.match(a.summary, /2% above August 2025/);
  assert.match(a.summary, /preliminary/);
  assert.match(JSON.stringify(a), /NEW houses/);
  assert.equal((a.extra as any).average_sales_price, 512000);
  assert.equal((a.extra as any).last_full_year.median, 417400);
});

test("a town, ZIP or state is refused honestly, never answered with the national figure", async () => {
  for (const p of [{ town: "Hartford" }, { postcode: "10001" }, { state: "CT" }, { property_type: "house" }]) {
    await assert.rejects(() => usNewHomeSales(p, async () => ({ data: parseNrs(workbook()), publishedAt: null })), InputError);
  }
});

test("isNationalRequest", () => {
  assert.equal(isNationalRequest({}), false); // a bare country=US stays with us-home-sales
  assert.equal(isNationalRequest({ property_type: "new" }), true);
  assert.equal(isNationalRequest({ town: "Hartford", property_type: "new" }), false);
  assert.equal(isNationalRequest({ town: "United States" }), true);
  assert.equal(isNationalRequest({ town: "USA", property_type: "new" }), true);
  assert.equal(isNationalRequest({ town: "Brooklyn" }), false);
  assert.equal(isNationalRequest({ postcode: "20001" }), false);
  assert.equal(isNationalRequest({ state: "DC" }), false);
  assert.equal(isNationalRequest({ property_type: "condo" }), false);
});

test("routing: national goes here, places stay with the town sources", () => {
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "us-census-new-home-sales"));
  assert.ok(countriesFor("home-sales").includes("US"));
  assert.equal(findSource("home-sales", "US", { country: "US", property_type: "new" })?.info.id, "us-census-new-home-sales");
  assert.equal(findSource("home-sales", "US", { country: "US" })?.info.id, "us-home-sales");
  assert.equal(findSource("home-sales", "US", { country: "US", town: "Hartford" })?.info.id, "us-home-sales");
  assert.equal(findSource("home-sales", "US", { country: "US", town: "Washington, DC" })?.info.id, "us-dc-home-sales");
  assert.equal(findSource("home-sales", "US", { country: "US", town: "Brooklyn" })?.info.id, "us-home-sales");
});

test("harvest row: one national median, NO_COUNT, dated by the month end", () => {
  const h = harvestFrom(parseNrs(workbook()));
  assert.equal(h.date, "2026-08-31");
  assert.equal(h.rows.length, 1);
  assert.deepEqual([h.rows[0].area, h.rows[0].item, h.rows[0].n, h.rows[0].median], ["ALL", HARVEST_ITEM, NO_COUNT, 412000]);
  assert.deepEqual(usNewHomeHistoryKey({ property_type: "new" }), { area: "ALL", item: HARVEST_ITEM, label: "United States, new houses" });
  assert.equal(usNewHomeHistoryKey({ town: "Hartford" }), null);
});

test("nrsAnswer with no year-earlier month still answers", () => {
  const r = readLatest(parseNrs(workbook(MONTHLY.slice(0, 7).concat([[serial(2026, 8), 412000, 512000]]) as any)));
  const a = nrsAnswer(r, {});
  assert.equal(a.status, "ok");
  assert.doesNotMatch(a.summary, /above|below/);
});
