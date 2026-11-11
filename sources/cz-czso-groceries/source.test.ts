// Tests for the Czechia grocery prices (CZSO table CEN0101NT01, monthly average consumer prices, CZK).
// Fixture: the real JSON-stat response https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101NT01 downloaded on 2026-11-11 (18 KB, 86 products x 2026-01..2026-10, updated 2026-11-10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { INFO, ITEMS, czAnswer, czGroceries, czHarvest, czHistoryKey, harvestRows, parseCz, readProduct } from "./source";
import manifest from "./index";

const JSON_DOC = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "CEN0101NT01.json"), "utf8"));
const table = parseCz(JSON_DOC);
const loader = async () => JSON_DOC;

test("parse: 86 products, ten months, the real October 2026 figures", () => {
  assert.equal(table.products.size, 86);
  assert.equal(table.months[0], "2026-01");
  assert.equal(table.months[table.months.length - 1], "2026-10");
  assert.equal(table.updated, "2026-11-10T08:00Z");
  const milk = readProduct(table, "01142001")!;
  assert.deepEqual(milk.latest, { month: "2026-10", price: 21.9 });
  assert.equal(milk.series.length, 10);
  assert.equal(readProduct(table, "01148001")!.latest.price, 42.38); // eggs, 10 pieces
  assert.equal(readProduct(table, "01152001")!.latest.price, 136.36); // butter, kg
  assert.equal(readProduct(table, "02130001")!.latest.price, 13.13); // beer 0.5 l
  assert.equal(readProduct(table, "99999999"), null);
});

test("parse: a different document fails loudly", () => {
  assert.throws(() => parseCz({ hello: "world" }), /./);
  assert.throws(() => parseCz({ ...JSON_DOC, id: ["a", "b"], size: [1, 1], dimension: { a: { category: { index: ["x"] } }, b: { category: { index: ["y"] } } }, value: [1] }), /changed shape/);
});

test("items: every mapped product exists in the real table and its unit matches CZSO's bracket; no tobacco", () => {
  const codes = new Set(ITEMS.map((i) => i.code));
  assert.equal(codes.size, ITEMS.length);
  for (const d of ITEMS) assert.ok(table.products.has(d.code), `missing in table: ${d.code}`);
  const labels = new Set(ITEMS.map((i) => i.label));
  assert.equal(labels.size, ITEMS.length, "labels are the library keys and must be unique");
  const unitOf = (name: string) => name.match(/\[([^\]]+)\]\s*$/)?.[1];
  const expected: Record<string, string> = { "1 kg": "per kg", "1 l": "per litre", "10 ks": "per 10 eggs", "100 g": "per 100 g", "150 g": "per 150 g", "1 ks": "per piece", "0,5 l": "per 0.5 litre bottle", "0,75 l": "per 0.75 litre bottle" };
  for (const d of ITEMS) {
    const u = unitOf(table.products.get(d.code)!.name)!;
    assert.equal(d.unit, expected[u], `${d.code} ${table.products.get(d.code)!.name}: unit ${u}`);
  }
  assert.equal(matchItem(ITEMS, "milk").primary!.code, "01142001");
  assert.equal(matchItem(ITEMS, "eggs").primary!.code, "01148001");
  assert.equal(matchItem(ITEMS, "bread").primary!.code, "01113001");
  assert.equal(matchItem(ITEMS, "beer").primary!.code, "02130001");
});

test("answer: official statistic, CZK, no range, no sample size, month period, labelled", async () => {
  const a = await czGroceries({ item: "milk" }, { loader });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "CZK");
  assert.equal(a.price!.value, 21.9);
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(a.source.id, "cz-czso-groceries");
  assert.match(a.source.attribution, /Czech Statistical Office/);
  assert.match(a.source.licence, /CC BY 4\.0/);
  const extra = a.extra as any;
  assert.equal(extra.reference_month, "2026-10");
  assert.equal(extra.published_by_month.length, 10);
  assert.equal(extra.published_by_month[9].average_price_czk, 21.9);
  assert.match(a.summary, /not a receipt/);
});

test("answer: eggs per 10; unknown food answers no_matches with hints; region ignored with a note; empty item is an input error", async () => {
  const e = await czGroceries({ item: "eggs" }, { loader });
  assert.equal(e.price!.unit, "per 10 eggs");
  assert.equal(e.price!.value, 42.38);
  const none = await czGroceries({ item: "caviar" }, { loader });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /Try one of/);
  const r = await czGroceries({ item: "milk", region: "Brno" }, { loader });
  assert.match(JSON.stringify(r.extra), /Brno/);
  const whole = await czGroceries({ item: "milk", region: "Czechia" }, { loader });
  assert.equal((whole.extra as any).region_note, undefined);
  assert.equal(czAnswer(null, null, [], { item: "x" }).status, "no_matches");
  await assert.rejects(() => czGroceries({ item: " " }, { loader }), /item is required/);
});

test("answer: a product missing from the newest month uses its latest month and says so", () => {
  const def = ITEMS.find((d) => d.code === "01142001")!;
  const r = readProduct(table, "01142001")!;
  const old = { ...r, series: r.series.slice(0, 8), latest: r.series[7] };
  const a = czAnswer(old, def, [], { item: "milk" });
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.match(String(a.statistic?.note), /latest available month/);
});

test("harvest: one row per mapped product for 2026-10, NO_COUNT, dated month end; history key", async () => {
  const h = harvestRows(table);
  assert.equal(h.date, "2026-10-31");
  assert.equal(h.currency, "CZK");
  assert.equal(h.rows.length, ITEMS.length);
  const milk = h.rows.find((r) => r.item === "Semi-skimmed milk, pasteurised")!;
  assert.equal(milk.median, 21.9);
  assert.equal(milk.area, "ALL");
  const h2 = await czHarvest({ loader, sleep: async () => {} });
  assert.equal(h2.rows.length, h.rows.length);
  assert.deepEqual(czHistoryKey({ item: "milk" }), { area: "ALL", item: "Semi-skimmed milk, pasteurised", label: "Czechia" });
  assert.equal(czHistoryKey({ item: "caviar" }), null);
  let calls = 0;
  await assert.rejects(() => czHarvest({ loader: async () => { calls++; throw new Error("down"); }, sleep: async () => {} }), /down/);
  assert.equal(calls, 3);
});

test("manifest: groceries, CZ only, working example, official statistic", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["CZ"]);
  assert.equal(manifest.examples![0].params.country, "CZ");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(manifest.referenceDates, true);
});
