// Tests for the UAE essential-goods source. The fixture is a trimmed copy (6 of 18 commodity rows) of the live page
// https://www.moet.gov.ae/en/essential-goods-prices-platform, fetched on 2026-11-04 (page "Last Updated: Nov 02, 2026 | 12:00 AM").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, KNOWN, answerFromRows, buildRows, defsFromRows, itemKey, matchItems, moetHistoryKey, libraryIsFresh, LIBRARY_FRESH_HOURS, parsePage, parseUpdated } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const html = readFileSync(new URL("./fixtures/moet-2026-11-04.html", import.meta.url), "utf8");
const page = parsePage(html);
const rows = buildRows(page);
const day = { date: "2026-11-02", rows };

test("page: date, 13 outlets, six commodities with units", () => {
  assert.equal(parseUpdated(html), "2026-11-02");
  assert.equal(page.date, "2026-11-02");
  assert.equal(page.outlets.length, 13);
  assert.equal(page.outlets[0], "Umm Al Quwain Coop");
  assert.deepEqual(page.commodities.map((c) => [c.name, c.unit]), [
    ["White Bread Slices", "kg"], ["Whole Chicken (Fresh)", "kg"], ["Fresh Whole Milk", "L"], ["Brown Eggs", "piece"], ["Red Lentils (Dry and Canned)", "kg"], ["Basmati Rice", "kg"],
  ]);
});

test("cells: price over pack size becomes a unit price; '-' means not listed", () => {
  const bread = page.commodities[0];
  assert.deepEqual(bread.prices[0], { outlet: "Umm Al Quwain Coop", price: 3.75, pack: 0.6, unitPrice: 6.25 });
  assert.ok(!bread.prices.some((p) => p.outlet === "Spinneys")); // Spinneys shows '-' for bread
  const eggs = page.commodities.find((c) => c.name === "Brown Eggs")!;
  assert.ok(Math.abs(eggs.prices[0].unitPrice - 23.4 / 30) < 1e-9);
});

test("rows: 5 or more outlet prices only, national only", () => {
  assert.ok(rows.length >= 4);
  for (const r of rows) { assert.equal(r.area, "ALL"); assert.ok(r.n >= 5); assert.ok(r.low <= r.median && r.median <= r.high); }
  const few = parsePage(html.replace(/(<tr[^>]*data-category="Basmati Rice"[\s\S]*?<\/tr>)/, (m) => m.replace(/badge-num[^>]*>\s*[\d.]+ AED/g, 'badge-num">-')));
  assert.ok(!buildRows(few).some((r) => r.item.startsWith("Basmati")));
});

test("answer: eggs, rice and the 5-record rule", () => {
  const a: any = answerFromRows(day, { item: "eggs", today: "2026-11-04" });
  assert.equal(a.status, "ok");
  assert.match(a.query.item, /Brown Eggs, per piece/);
  assert.equal(a.price.currency, "AED");
  assert.ok(a.sample_size >= 5);
  assert.equal(a.price_type, "posted_price");
  const rice: any = answerFromRows(day, { item: "basmati rice", today: "2026-11-04" });
  assert.ok(rice.price.median > 3 && rice.price.median < 40);
  const none: any = answerFromRows(day, { item: "caviar", today: "2026-11-04" });
  assert.notEqual(none.status, "ok");
  assert.match(JSON.stringify(none), /Commodities held/);
  assert.throws(() => answerFromRows(day, { item: "" }), /item is required/);
  const old: any = answerFromRows(day, { item: "eggs", today: "2027-03-01" });
  assert.equal(old.extra.stale_source, true);
});

test("matching and history keys", () => {
  assert.equal(matchItems(defsFromRows(rows), "milk")[0].name, "Fresh Whole Milk");
  assert.equal(moetHistoryKey({ item: "eggs" })!.item, itemKey("Brown Eggs", "piece"));
  assert.equal(moetHistoryKey({ item: "" }), null);
  assert.equal(KNOWN.length, 18);
});

test("bad layouts fail loudly", () => {
  assert.throws(() => parsePage("<html>nothing</html>"), /new layout/);
  assert.throws(() => parsePage('<table class="price-table"><thead><tr><th>No</th><th>Commodity</th><th>Units</th></tr></thead></table>'), /new layout/);
});

test("manifest: groceries tool, AE only, licence unclear so free tier", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["AE"]);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("AE"));
  assert.match(INFO.licence, /UNVERIFIED/);
});

test("library-first: a copy collected within 36 hours is fresh, an older or missing one is not", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  assert.equal(LIBRARY_FRESH_HOURS, 36);
  assert.equal(libraryIsFresh("2026-11-05T10:55:35.718Z", now), true);
  assert.equal(libraryIsFresh("2026-11-04T06:00:00Z", now), true);
  assert.equal(libraryIsFresh("2026-11-03T11:00:00Z", now), false);
  assert.equal(libraryIsFresh(null, now), false);
  assert.equal(libraryIsFresh("not a date", now), false);
  assert.equal(libraryIsFresh("2026-11-06T00:00:00Z", now), false);
});
