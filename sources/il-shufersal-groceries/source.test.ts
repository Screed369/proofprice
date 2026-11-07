// Tests for the Israel (Shufersal) grocery source. Fixtures are trimmed copies of the live formats fetched on 2026-11-07:
// fixtures/listing-2026-11-07.html = 3 rows of https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=0&page=1 (signatures redacted),
// fixtures/pricefull-001-002-2026-11-07.xml = 7 basket items + 2 other items of the store file PriceFull7290027600007-001-002-20261107-030000.gz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASKET, INFO, answerFromRows, buildRows, defsFromRows, itemKey, matchItems, parseListing, parseStoreFile, shufersalHistoryKey, storePrices, unitPrice } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const listing = readFileSync(new URL("./fixtures/listing-2026-11-07.html", import.meta.url), "utf8");
const xml = readFileSync(new URL("./fixtures/pricefull-001-002-2026-11-07.xml", import.meta.url), "utf8");

test("listing: PriceFull files with store ids, dates and the page count", () => {
  const { files, pages } = parseListing(listing);
  assert.equal(files.length, 3);
  assert.equal(pages, 22);
  assert.equal(files[0].chain, "7290027600007");
  assert.equal(files[0].sub, "001");
  assert.equal(files[0].store, "001");
  assert.equal(files[0].date, "2026-11-07");
  assert.match(files[0].url, /^https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/pricefull\//);
  assert.ok(!files[0].url.includes("&amp;"));
  assert.throws(() => parseListing("<html>no table</html>"), /new layout/);
});

test("store file: only basket items are read", () => {
  const p = parseStoreFile(xml);
  assert.equal(p.chain, "7290027600007");
  assert.equal(p.store, "002");
  assert.equal(p.items.length, 7); // 7 basket items; the other two (a bread not in the basket and a non-food item) are skipped
  const eggs = p.items.find((i) => i.code === "7290001201862")!;
  assert.equal(eggs.price, 23.9);
  assert.throws(() => parseStoreFile("<html></html>"), /new layout/);
});

test("unit prices: kg, 100 g quantities in grams, litres, pieces", () => {
  const byName = (n: string) => BASKET.find((b) => b.name === n)!;
  assert.ok(Math.abs(unitPrice({ code: "x", price: 14.7, qty: 2, uom: "1ליטר" }, byName("Milk 3% fat"))! - 7.35) < 1e-9);
  assert.ok(Math.abs(unitPrice({ code: "x", price: 9.1, qty: 900, uom: "100 גרם" }, byName("Standard sliced bread"))! - 10.111111) < 1e-5);
  assert.equal(unitPrice({ code: "x", price: 8.9, qty: 1, uom: "1קילוגרם" }, byName("White rice")), 8.9);
  assert.ok(Math.abs(unitPrice({ code: "x", price: 15, qty: 750, uom: "100 מיליליטר" }, byName("Canola oil"))! - 20) < 1e-9);
  assert.ok(Math.abs(unitPrice({ code: "x", price: 24, qty: 1, uom: "יחידות" }, byName("Eggs (12-pack M or L)"))! - 2) < 1e-9);
  assert.equal(unitPrice({ code: "x", price: 5, qty: 1, uom: "יחידות" }, byName("White rice")), null);
  assert.equal(unitPrice({ code: "x", price: 5, qty: 0, uom: "1קילוגרם" }, byName("White rice")), null);
});

test("store prices: one price per item, median of matching barcodes", () => {
  const m = storePrices([
    { code: "7290000211169", price: 8.9, qty: 1, uom: "1קילוגרם" },
    { code: "7290000211442", price: 12.9, qty: 1, uom: "1קילוגרם" },
    { code: "7290000211169", price: 0, qty: 1, uom: "1קילוגרם" }, // zero price ignored
  ]);
  assert.equal(m.size, 1);
  assert.equal(m.get(itemKey("White rice", "kg")), 10.9);
  const real = storePrices(parseStoreFile(xml).items);
  assert.ok(real.size >= 6);
  const egg = real.get(itemKey("Eggs (12-pack M or L)", "piece"))!;
  assert.ok(egg > 1 && egg < 4);
  const tom = real.get(itemKey("Tomatoes", "kg"))!;
  assert.ok(tom > 3 && tom < 30);
});

function fakeStores(n: number): Map<string, number>[] {
  return Array.from({ length: n }, (_, i) => new Map([[itemKey("Eggs (12-pack M or L)", "piece"), 1.9 + (i % 5) * 0.05], [itemKey("Milk 3% fat", "L"), 7.35]]));
}

test("rows: national only, 5 or more stores only", () => {
  const rows = buildRows(fakeStores(8));
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.area, "ALL"); assert.equal(r.n, 8); assert.ok(r.low <= r.median && r.median <= r.high); }
  assert.equal(buildRows(fakeStores(4)).length, 0);
});

test("answer: eggs, milk, no match, stale, empty item", () => {
  const day = { date: "2026-11-07", rows: buildRows(fakeStores(30)) };
  const a: any = answerFromRows(day, { item: "eggs", today: "2026-11-08" });
  assert.equal(a.status, "ok");
  assert.match(a.query.item, /Eggs.*per piece/);
  assert.equal(a.price.currency, "ILS");
  assert.equal(a.sample_size, 30);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.extra.chain, "Shufersal");
  const milk: any = answerFromRows(day, { item: "milk", today: "2026-11-08" });
  assert.equal(milk.price.median, 7.35);
  const none: any = answerFromRows(day, { item: "caviar", today: "2026-11-08" });
  assert.notEqual(none.status, "ok");
  assert.match(JSON.stringify(none), /Items held/);
  assert.throws(() => answerFromRows(day, { item: "" }), /item is required/);
  const old: any = answerFromRows(day, { item: "eggs", today: "2026-12-01" });
  assert.equal(old.extra.stale_source, true);
});

test("matching and history keys", () => {
  const rows = buildRows(fakeStores(10));
  assert.equal(matchItems(defsFromRows(rows), "egg")[0].name, "Eggs (12-pack M or L)");
  assert.equal(shufersalHistoryKey({ item: "tomato" })!.item, itemKey("Tomatoes", "kg"));
  assert.equal(shufersalHistoryKey({ item: "cottage cheese" })!.item, itemKey("Cottage cheese 5%", "kg"));
  assert.equal(shufersalHistoryKey({ item: "" }), null);
  assert.equal(shufersalHistoryKey({ item: "caviar" }), null);
  const codes = BASKET.flatMap((b) => b.codes);
  assert.equal(new Set(codes).size, codes.length); // a barcode belongs to one basket item
});

test("manifest: groceries tool, IL only, licence unclear so free tier", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["IL"]);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("IL"));
  assert.match(INFO.licence, /UNVERIFIED/);
});
