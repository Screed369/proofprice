// Tests for the Hong Kong Online Price Watch source. The fixture is the first 217 products of the live feed
// https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json, probed from GitHub's servers on 2026-10-20 (file last modified 2026-10-20 05:00 GMT).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, buildRows, chainName, defsFor, feedDate, itemKey, matchItems, packSize, parseFeed, pricewatchAnswerFromRows, resolveChain } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const fixture = readFileSync(new URL("./fixtures/pricewatch-2026-10-20.json", import.meta.url), "utf8");
const products = parseFeed(fixture);
const built = buildRows(products);
const day = { date: "2026-10-20", rows: built.rows };

test("feed: products keep English names, categories and one price per chain", () => {
  assert.equal(products.length, 217);
  const milk = products.find((p) => p.code === "P000000891")!;
  assert.equal(milk.name, "100% Fresh Milk 946mL");
  assert.equal(milk.cat3, "Chilled fresh milk/milk drinks");
  assert.deepEqual(milk.prices.map((x) => [x.chain, x.price]), [["Wellcome", 32], ["ParknShop", 28], ["Jasons", 32], ["AEON", 30.5]]);
});

test("feed: bad layouts and junk rows", () => {
  assert.throws(() => parseFeed("<html>"), /JSON/);
  assert.throws(() => parseFeed('{"a":1}'), /new layout/);
  const p = parseFeed(JSON.stringify([{ code: "x", name: { en: "A" }, cat3Name: { en: "C" }, prices: [{ supermarketCode: "WELLCOME", price: "abc" }, { supermarketCode: "AEON", price: "-1" }] }, { prices: [] }]));
  assert.equal(p.length, 0);
  assert.equal(chainName("ZZSTORE"), "Zzstore");
});

test("pack sizes: grams, kilos, millilitres, litres and multipacks", () => {
  assert.deepEqual(packSize("Classic Corn Flakes 275g"), { kind: "kg", amount: 0.275 });
  assert.deepEqual(packSize("XTRA Crunchy Peanut Butter 510 gm"), { kind: "kg", amount: 0.51 });
  assert.deepEqual(packSize("100% Fresh Milk 946mL"), { kind: "L", amount: 0.946 });
  assert.deepEqual(packSize("Soy Milk 250ml x 6"), { kind: "L", amount: 1.5 });
  assert.deepEqual(packSize("Cola 6 x 330ml"), { kind: "L", amount: 1.98 });
  assert.deepEqual(packSize("Rice 5kg"), { kind: "kg", amount: 5 });
  assert.equal(packSize("Hot Dog Buns 4pcs"), null);
  assert.equal(packSize("CRUSTLESS WHEAT SANDWICH BREAD 6S 6SLICES"), null);
});

test("rows: unit price per kg for honey, per pack for bread; only 5 or more shelf prices; ALL and chain rows", () => {
  assert.ok(built.rows.length > 20);
  for (const r of built.rows) assert.ok(r.n >= 5, `${r.area} ${r.item} has ${r.n}`);
  const honey = built.rows.find((r) => r.area === "ALL" && r.item === itemKey("Honey", "kg"));
  assert.ok(honey, "Honey per kg exists");
  assert.ok(honey!.n >= 20);
  // acacia honey 250 g at HK$64-80 is HK$256-320 per kg; the whole category sits between a few dozen and a few hundred dollars per kg
  assert.ok(honey!.median > 80 && honey!.median < 400, `median ${honey!.median}`);
  assert.ok(honey!.low <= honey!.median && honey!.median <= honey!.high);
  const bread = built.rows.find((r) => r.area === "ALL" && r.item === itemKey("Bread loaf", "pack"));
  assert.ok(bread && bread.median > 8 && bread.median < 40, `bread median ${bread?.median}`);
  assert.ok(built.rows.some((r) => r.area === "Wellcome"));
  assert.ok(built.chains.includes("ParknShop"));
});

test("library keys: no colon, pipe or comma inside the category", () => {
  assert.equal(itemKey("Milk, fresh: A|B", "L"), "Milk/fresh A B|L");
  for (const r of built.rows) assert.equal(r.item.split("|").length, 2);
});

test("answer: honey, national and one chain, with by-chain medians and the posted-price label", () => {
  const a = pricewatchAnswerFromRows(day, { item: "honey", today: "2026-10-21" });
  assert.equal(a.status, "ok");
  assert.equal(a.query.country, "HK");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.unit, "per kg");
  assert.ok(a.sample_size! >= 20);
  assert.match(a.price_type, /posted/);
  assert.match(a.summary, /posted shelf prices/);
  assert.match(a.summary, /not receipts/);
  assert.ok(Array.isArray((a.extra as any).by_chain) && (a.extra as any).by_chain.length >= 2);
  const w = pricewatchAnswerFromRows(day, { item: "honey", region: "wellcome", today: "2026-10-21" });
  assert.equal(w.status, "ok");
  assert.equal(w.query.region, "Wellcome");
  assert.ok(w.sample_size! >= 5 && w.sample_size! <= a.sample_size!);
});

test("answer: the exact question 'peanut butter' and a multi-word category", () => {
  const a = pricewatchAnswerFromRows(day, { item: "peanut butter", today: "2026-10-20" });
  assert.equal(a.status, "ok");
  assert.match(a.query.item as string, /Peanut butter/);
});

test("answer: unknown item gives an empty answer with a hint; unknown chain is an input error; thin data never answers", () => {
  const none = pricewatchAnswerFromRows(day, { item: "caviar", today: "2026-10-20" });
  assert.notEqual(none.status, "ok");
  assert.match(JSON.stringify(none.extra), /Categories held include/);
  assert.throws(() => pricewatchAnswerFromRows(day, { item: "honey", region: "Tesco" }), /not a supermarket chain/);
  assert.throws(() => pricewatchAnswerFromRows(day, { item: "" }), /item is required/);
});

test("answer: an old copy says so", () => {
  const a = pricewatchAnswerFromRows(day, { item: "honey", today: "2026-11-05" });
  assert.equal((a.extra as any).stale, true);
  assert.match(a.summary, /collected 16 days ago/);
});

test("matching: generic names rank first, units do not duplicate a category, chain aliases", () => {
  const defs = defsFor(day.rows, "ALL");
  const hits = matchItems(defs, "bread");
  assert.ok(hits.length >= 1);
  assert.equal(new Set(hits.map((h) => h.name)).size, hits.length);
  assert.equal(resolveChain(day.rows, "Park n Shop"), "ParknShop");
  assert.equal(resolveChain(day.rows, "AEON supermarket"), "AEON");
  assert.equal(resolveChain(day.rows, "nonexistent"), null);
});

test("feedDate: Last-Modified day, else today", () => {
  assert.equal(feedDate("Tue, 20 Oct 2026 05:00:02 GMT"), "2026-10-20");
  assert.equal(feedDate(null, new Date("2026-10-21T10:00:00Z")), "2026-10-21");
});

test("manifest: groceries category, Hong Kong, posted price, licence and attribution", () => {
  assert.deepEqual(manifest.countries, ["HK"]);
  assert.equal(manifest.category, "groceries");
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("HK"));
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.attribution, /DATA\.GOV\.HK/);
  assert.ok(manifest.harvest && manifest.historyKey);
});
