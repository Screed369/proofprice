// Tests for the Bulgaria grocery prices (NSI Household Budget Survey, table HH_6.1, EUR, English).
// Fixture: the real workbook https://www.nsi.bg/sites/default/files/files/data/timeseries/HH_6.1_EUR_en.xlsx downloaded on 2026-11-10 (34 KB, unchanged).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { INFO, ITEMS, bgNsiGroceries, bgNsiHarvest, bgNsiHistoryKey, harvestRows, nsiAnswer, parseNsi, readFood } from "./source";
import manifest from "./index";

const BYTES = readFileSync(path.join(__dirname, "fixtures", "HH_6.1_EUR_en.xlsx"));
const table = parseNsi(BYTES);

test("parse: years, foods and the real 2025 figures", () => {
  assert.equal(table.years[0], 2008);
  assert.equal(table.years[table.years.length - 1], 2025);
  assert.match(table.title, /AVERAGE PRICES AND PURCHASED QUANTITIES/);
  assert.ok(table.foods.size >= 80);
  assert.ok(!table.foods.has("Bread"), "group headers carry no unit and are skipped");
  const rice = readFood(table, "Rice")!;
  assert.deepEqual(rice.latest, { year: 2025, price: 2.15, quantity: 11.2 });
  assert.equal(readFood(table, "White bread")!.latest.price, 1.5);
  assert.equal(readFood(table, "Flour")!.latest.price, 0.94);
  assert.equal(readFood(table, "Pasta products")!.latest.price, 2.6);
  assert.equal(readFood(table, "Eggs")!.fileUnit, "number");
  assert.equal(readFood(table, "Rice")!.series[0].year, 2008);
});

test("parse: a different file fails loudly", () => {
  assert.throws(() => parseNsi(Buffer.from("not a workbook")), /./);
});

test("items: every mapped food exists in the real file; no tobacco", () => {
  const codes = new Set(ITEMS.map((i) => i.code));
  assert.equal(codes.size, ITEMS.length);
  for (const d of ITEMS) assert.ok(table.foods.has(d.code), `missing in file: ${d.code}`);
  assert.ok(!codes.has("Cigarettes"));
  assert.equal(matchItem(ITEMS, "milk").primary!.code, "Milk");
  assert.equal(matchItem(ITEMS, "eggs").primary!.code, "Eggs");
  assert.equal(matchItem(ITEMS, "bread").primary!.code, "White bread");
  assert.equal(matchItem(ITEMS, "chicken").primary!.code, "Poultry meat");
});

test("answer: official statistic, no range, no sample size, EUR, labelled", async () => {
  const a = await bgNsiGroceries({ item: "milk" }, { loader: async () => BYTES });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.value, 1.5);
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal(a.source.id, "bg-nsi-groceries");
  assert.match(a.source.attribution, /National Statistical Institute of Bulgaria/);
  const extra = a.extra as any;
  assert.equal(extra.reference_year, 2025);
  assert.equal(extra.published_by_year.length, 8);
  assert.equal(extra.published_by_year[7].average_price_eur, 1.5);
  assert.match(a.summary, /not a shelf price or receipt/);
});

test("answer: eggs are priced per egg; an unknown food answers no_matches with hints; region is ignored with a note", async () => {
  const e = await bgNsiGroceries({ item: "eggs" }, { loader: async () => BYTES });
  assert.equal(e.price!.unit, "per egg");
  assert.equal(e.price!.value, 0.22);
  const none = await bgNsiGroceries({ item: "caviar" }, { loader: async () => BYTES });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /Try one of/);
  const r = await bgNsiGroceries({ item: "milk", region: "Plovdiv" }, { loader: async () => BYTES });
  assert.match(JSON.stringify(r.extra), /Plovdiv/);
  assert.equal(nsiAnswer(null, null, [], { item: "x" }).status, "no_matches");
});

test("harvest: one row per mapped food for 2025, NO_COUNT, dated 2025-12-31; history key", async () => {
  const h = harvestRows(table);
  assert.equal(h.date, "2025-12-31");
  assert.equal(h.currency, "EUR");
  assert.equal(h.rows.length, ITEMS.length);
  const milk = h.rows.find((r) => r.item === "Milk")!;
  assert.equal(milk.median, 1.5);
  assert.equal(milk.area, "ALL");
  const h2 = await bgNsiHarvest({ loader: async () => BYTES, sleep: async () => {} });
  assert.equal(h2.rows.length, h.rows.length);
  assert.deepEqual(bgNsiHistoryKey({ item: "milk" }), { area: "ALL", item: "Milk", label: "Bulgaria" });
  assert.equal(bgNsiHistoryKey({ item: "caviar" }), null);
});

test("manifest: groceries, BG only, working example, free tier (licence unclear)", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["BG"]);
  assert.equal(manifest.examples![0].params.country, "BG");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /derivative/);
});
