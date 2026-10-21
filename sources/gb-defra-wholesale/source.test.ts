// Fixture fixtures/fruitveg-2026-10-12.csv: the first 20 KB of the real DEFRA file (fruitvegprices-261012.csv; apples to celeriac), captured 2026-10-20 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, csvUrlFromApi, gbWholesale, gbWholesaleFromRows, matchSeries, parseCsv, seriesOf } from "./source";

const CSV = readFileSync(new URL("./fixtures/fruitveg-2026-10-12.csv", import.meta.url), "utf8");
const rows = parseCsv(CSV);

test("parses the real file and keeps only priced rows", () => {
  assert.ok(rows.length > 300);
  assert.ok(rows.every((r) => r.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.category !== "cut_flowers"));
});

test("a changed layout is an error", () => {
  assert.throws(() => parseCsv("a,b,c\n1,2,3"), /changed the layout/);
});

test("the CSV link comes from the content API attachments", () => {
  const api = { details: { attachments: [
    { content_type: "application/vnd.oasis.opendocument.spreadsheet", url: "https://assets.publishing.service.gov.uk/media/a/x.ods" },
    { content_type: "text/csv", url: "https://assets.publishing.service.gov.uk/media/6ac8b0a5f1ba855cc196a9c2/fruitvegprices-261012.csv" },
  ] } };
  assert.match(csvUrlFromApi(api), /fruitvegprices-261012\.csv$/);
  assert.throws(() => csvUrlFromApi({ details: { attachments: [] } }), /no longer lists a CSV/);
  assert.throws(() => csvUrlFromApi({ details: { attachments: [{ content_type: "text/csv", url: "https://evil.example/x.csv" }] } }), /no longer lists a CSV/);
});

test("one variety gives one price with its history", () => {
  const a = gbWholesaleFromRows(rows, { product: "gala apples" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.value, 1.28); // fruit,apples,gala,2026-10-12,1.28,kg
  assert.equal(a.period.to, "2026-10-12");
  assert.equal(a.sample_size, null);
  assert.ok((a.extra?.recent_dates as any[]).length >= 2);
  assert.match(a.summary, /England and Wales/);
});

test("an item with several varieties gives their unweighted mean and lists them", () => {
  const a = gbWholesaleFromRows(rows, { product: "apples" });
  assert.equal(a.status, "ok");
  const vs = a.extra?.varieties as any[];
  assert.ok(vs.length >= 5);
  const mean = Math.round((vs.reduce((s, v) => s + v.price_gbp, 0) / vs.length) * 100) / 100;
  assert.equal(a.price?.value, mean);
  assert.match(String(a.statistic?.note ?? a.notice ?? ""), /unweighted mean|wholesale/);
});

test("units are never mixed: cabbage is priced per kg and per head", () => {
  const a = gbWholesaleFromRows(rows, { product: "cabbage" });
  assert.equal(a.status, "ok");
  assert.ok(["per kg", "per head"].includes(a.price!.unit));
  const other = a.extra?.other_units as any[];
  assert.ok(other.length >= 1, "the other unit is reported, not averaged in");
});

test("plural and singular both match", () => {
  assert.ok(matchSeries(seriesOf(rows), "carrot").length > 0);
  assert.ok(matchSeries(seriesOf(rows), "strawberry").length > 0);
});

test("unknown product gives no_matches that lists what exists", () => {
  const a = gbWholesaleFromRows(rows, { product: "durian" });
  assert.equal(a.status, "no_matches");
  assert.match(String(a.extra?.note), /apples/);
});

test("missing product is an input error", async () => {
  await assert.rejects(() => gbWholesale({ product: " " }, async () => rows), /product is required/);
});

test("licence and attribution are filled in", () => {
  assert.match(INFO.attribution, /Open Government Licence v3.0/);
  assert.match(INFO.licence_url, /open-government-licence/);
});

test("several varieties: the cheapest and dearest are min and max, not the 10th-90th percentile; one figure is not a thin range", () => {
  const a = gbWholesaleFromRows(rows, { product: "apples" });
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.ok(a.price!.min! > 0 && a.price!.max! >= a.price!.min!);
  assert.equal(a.reliability, "official_median_no_count");
  assert.doesNotMatch(a.summary, /Official average/);
  assert.equal(a.evidence!.label, "Posted or listed price");
});
