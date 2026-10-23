// Tests for US fed cattle (USDA AMS LM_CT154). Rows copied from the real Detail replies captured through the GitHub probe on 2026-10-23
// (report date 10/19/2026; the real reply has ~60 rows per class and basis, only the first grades are kept here). The prior-week rows
// (10/12/2026) are constructed to test the week-on-week change and are marked as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, PRODUCTS, buildCattleAnswer, detailUrl, harvestRows, livestockHarvest, livestockHistoryKey, matchProduct, parseDetail, usLivestock } from "./source";
import manifest from "./index";

const row = (date: string, cls: string, basis: string, grade: string, head: string | null, avg: string | null, lo: string | null = null, hi: string | null = null, wt: string | null = null, src = "Domestic", purchase = "NEGOTIATED CASH") => ({
  report_date: date, class_description: cls, source_description: src, selling_basis_description: basis, purchase_type_code: purchase, grade_description: grade,
  head_count: head, weight_range_avg: wt, price_range_low: lo, price_range_high: hi, weighted_avg_price: avg, slug_id: "2481",
});
const REAL = [
  row("10/19/2026", "STEER", "LIVE FOB", "Over 80% Choice", "34,701", "224.37", "207.00", "228.50", "1,592"),
  row("10/19/2026", "STEER", "LIVE FOB", "65 - 80% Choice", "3,237", "227.79", "226.00", "228.00", "1,464"),
  row("10/19/2026", "STEER", "LIVE FOB", "35 - 65% Choice", "646", "228.19", "228.00", "228.50", "1,522"),
  row("10/19/2026", "HEIFER", "LIVE FOB", "Over 80% Choice", "9,961", "224.79", "220.00", "228.00", "1,403"),
  row("10/19/2026", "HEIFER", "LIVE FOB", "65 - 80% Choice", "2,558", "227.60", "226.00", "228.00", "1,324"),
  row("10/19/2026", "HEIFER", "LIVE FOB", "35 - 65% Choice", null, null),
  row("10/19/2026", "STEER", "DRESSED FOB", "Over 80% Choice", "4,312", "351.06", "348.00", "359.00", "1,041"),
  row("10/19/2026", "STEER", "DRESSED FOB", "65 - 80% Choice", null, null),
];
// constructed prior week (not real): 100 head steers live at 220.00
const PRIOR = [row("10/12/2026", "STEER", "LIVE FOB", "Over 80% Choice", "100", "220.00")];
const REPLY = { reportSection: "Detail", results: [...PRIOR, ...REAL] };
const TODAY = new Date("2026-10-23T12:00:00Z");
const get = async () => REPLY;
const steer = PRODUCTS[0], heifer = PRODUCTS[1], dressed = PRODUCTS[2];

test("parseDetail combines grades as a head-weighted mean and skips rows with no trade", () => {
  const w = parseDetail(REPLY, steer);
  assert.deepEqual(w.map((x) => x.date), ["2026-10-12", "2026-10-19"]);
  const last = w[1];
  assert.equal(last.head, 34701 + 3237 + 646);
  assert.equal(last.value, 224.72); // (34701*224.37+3237*227.79+646*228.19)/38584
  assert.equal(last.grades.length, 3);
  const h = parseDetail(REPLY, heifer);
  assert.equal(h.length, 1);
  assert.equal(h[0].grades.length, 2, "null grade row skipped");
});

test("parseDetail keeps only Domestic negotiated cash rows of the right basis and rejects a reply without results", () => {
  const w = parseDetail({ results: [row("10/19/2026", "STEER", "LIVE FOB", "x", "500", "200", null, null, null, "Imported"), row("10/19/2026", "STEER", "LIVE FOB", "x", "500", "200", null, null, null, "Domestic", "FORMULA"), row("10/19/2026", "STEER", "LIVE FOB", "x", "3", "200")] }, steer);
  assert.equal(w.length, 0);
  assert.equal(parseDetail(REPLY, dressed)[0].value, 351.06);
  assert.throws(() => parseDetail({ message: "x" }, steer), /unexpected reply/);
});

test("cattle: newest week, head as sample size, attribution, per cwt price, change on prior week", async () => {
  const a = await usLivestock({ product: "cattle", today: TODAY }, get);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.value, 224.72);
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, 38584);
  assert.equal(a.price_type, "transaction");
  assert.deepEqual(a.period, { from: "2026-10-19", to: "2026-10-19" });
  assert.match(a.summary, /US packers paid an average of US\$224\.72 per hundredweight for fed steers \(live weight, FOB the feedlot\) on negotiated cash terms in the week reported on 19 October 2026 \(38,584 head\)/);
  assert.match(a.summary, /2\.1% higher than the week reported on 12 October 2026/);
  assert.match(a.source.attribution, /USDA Agricultural Marketing Service/);
  const x = a.extra as any;
  assert.equal(x.usd_per_lb, 2.25);
  assert.equal(x.by_grade.length, 3);
});

test("heifers and dressed steers answer with their own series; unknown product lists choices", async () => {
  const h = await usLivestock({ product: "heifers", today: TODAY }, get);
  assert.equal(h.sample_size, 9961 + 2558);
  const d = await usLivestock({ product: "dressed steers", today: TODAY }, get);
  assert.equal(d.price?.value, 351.06);
  assert.match(d.summary, /dressed \(carcass\) weight/);
  await assert.rejects(() => usLivestock({ product: "bison", today: TODAY }, get), /no USDA fed-cattle series matches/);
  await assert.rejects(() => usLivestock({ product: "", today: TODAY }, get), /product is required/);
});

test("an empty window is a clear error, not a made-up figure", () => {
  assert.throws(() => buildCattleAnswer(steer, [], { product: "cattle" }, TODAY), /holds no negotiated/);
});

test("request URL always carries a date range and the class and basis filters", () => {
  const u = detailUrl(heifer, TODAY);
  assert.equal(u, "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2481/Detail?q=report_date=10/09/2026:10/23/2026;class_description=HEIFER;selling_basis_description=LIVE%20FOB");
});

test("product matching: plural, everyday words", () => {
  assert.equal(matchProduct("Steers")?.key, "steer-live");
  assert.equal(matchProduct("beef cattle")?.key, "steer-live");
  assert.equal(matchProduct("heifer")?.key, "heifer-live");
  assert.equal(matchProduct("kangaroo"), null);
});

test("harvest rows: one row per product on the newest week, n is head, history key matches", async () => {
  const r = harvestRows(PRODUCTS.map((p) => ({ product: p, weeks: parseDetail(REPLY, p) })));
  assert.equal(r.date, "2026-10-19");
  assert.equal(r.currency, "USD");
  const rows = r.rows;
  assert.equal(rows.length, 3, "dressed heifers have no rows in the fixture, so only 3 products");
  const s = rows.find((x) => x.item.startsWith("Fed steers, live"))!;
  assert.equal(s.median, 224.72);
  assert.equal(s.n, 38584);
  const key = livestockHistoryKey({ product: "cattle" })!;
  assert.equal(key.item, s.item);
  assert.equal(key.area, "United States");
  const h = await livestockHarvest(TODAY, get);
  assert.equal(h.rows.length, 3);
  assert.throws(() => harvestRows(PRODUCTS.map((p) => ({ product: p, weeks: [] }))), /no usable/);
});

test("manifest: licence and attribution are filled in", () => {
  assert.equal(manifest.info.id, "us-ams-livestock");
  assert.match(INFO.licence, /CC0/);
  assert.deepEqual(manifest.countries, ["US"]);
});
