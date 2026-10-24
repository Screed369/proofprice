// Fixture: fixtures/rows-2026-10-23.json holds REAL records copied on 2026-10-24 from
// https://datos.odepa.gob.cl/api/3/action/datastore_search?resource_id=580beca0-e87e-4dd4-9e8a-0bd92773f4a6&filters={"Fecha":"2026-10-23"}&limit=1000 (probe cl-whl-d1 from GitHub's servers),
// kept for 11 products. The probe asked for fields without Fecha, so "Fecha": "2026-10-23" is added from the filter that was used. The layout test uses the three full records of probe vc-cl8.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { answerFromRows, clHarvest, clHistoryKey, clWholesale, harvestFromRows, num, parseRecords, resolveProduct, unitFactor } from "./source";

const REAL = JSON.parse(readFileSync(new URL("./fixtures/rows-2026-10-23.json", import.meta.url), "utf8")).result.records as Record<string, any>[];
const ROWS = parseRecords(REAL);

test("cl-odepa-wholesale: decimal comma prices and pack units convert", () => {
  assert.equal(num("20500,0000"), 20500);
  assert.equal(num("18473,6842"), 18473.6842);
  assert.ok(Number.isNaN(num("")));
  assert.deepEqual(unitFactor("$/bandeja 18 kilos"), { basis: "kg", divisor: 18 });
  assert.deepEqual(unitFactor("$/kilo (en caja de 17 kilos)"), { basis: "kg", divisor: 1 });
  assert.deepEqual(unitFactor("$/bins (400 kilos)"), { basis: "kg", divisor: 400 });
  assert.deepEqual(unitFactor("$/saco 25 kilos"), { basis: "kg", divisor: 25 });
  assert.deepEqual(unitFactor("$/caja 15 unidades"), { basis: "unit", divisor: 15 });
  assert.deepEqual(unitFactor("$/unidad"), { basis: "unit", divisor: 1 });
  assert.equal(unitFactor("$/docena de atados"), null);
  assert.equal(unitFactor("$/caja 36 atados"), null);
});

test("cl-odepa-wholesale: parsing real records gives per-kg and per-unit rows", () => {
  assert.ok(ROWS.length > 200);
  const tomato = ROWS.filter((r) => r.product === "Tomate");
  assert.ok(tomato.length >= 40);
  const first = REAL.find((r) => r.Producto === "Tomate" && r["Unidad de comercializacion"] === "$/bandeja 18 kilos" && r["Precio promedio"] === "20500,0000")!;
  const row = parseRecords([first])[0];
  assert.equal(row.price, 1138.89); // 20,500 CLP per 18 kg tray
  assert.equal(row.basis, "kg");
  assert.equal(row.date, "2026-10-23");
  assert.ok(ROWS.filter((r) => r.product === "Lechuga").every((r) => r.basis === "unit"));
});

test("cl-odepa-wholesale: a changed layout is a SourceError", () => {
  assert.throws(() => parseRecords([{ foo: 1 }]), SourceError);
  assert.deepEqual(parseRecords([]), []);
});

test("cl-odepa-wholesale: real tomato day gives a CLP per kg range with sample size, period and licence", () => {
  const a = answerFromRows(ROWS, { product: "tomato" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "CLP");
  assert.equal(a.price!.unit, "per kg");
  assert.ok(a.sample_size! >= 40);
  assert.ok(a.price!.median > 300 && a.price!.median < 3000, `median ${a.price!.median}`); // 18 kg trays at ~CLP 10,000-30,000
  assert.ok(a.price!.min <= a.price!.median && a.price!.median <= a.price!.max);
  assert.equal(a.period.to, "2026-10-23");
  assert.equal(a.price_type, "transaction");
  assert.match(a.source.licence, /Attribution/);
  assert.match(a.source.attribution, /ODEPA/);
});

test("cl-odepa-wholesale: lettuce is sold by the piece and answers per unit", () => {
  const a = answerFromRows(ROWS, { product: "lettuce" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.unit, "per unit");
});

test("cl-odepa-wholesale: Spanish names, aliases and market filter", () => {
  assert.equal(resolveProduct("Papa")!.key, "potato");
  assert.equal(resolveProduct("Limón")!.key, "lemon");
  assert.equal(resolveProduct("potatoes")!.key, "potato");
  assert.equal(resolveProduct("unobtainium"), null);
  const all = answerFromRows(ROWS, { product: "potato" });
  const lv = answerFromRows(ROWS, { product: "potato", market: "Lo Valledor" });
  assert.ok(lv.sample_size! < all.sample_size!);
  assert.deepEqual((lv.extra as any).markets, ["Mercado Mayorista Lo Valledor de Santiago"]);
  assert.throws(() => answerFromRows(ROWS, { product: "potato", market: "Atlantis" }), InputError);
});

test("cl-odepa-wholesale: fewer than 5 records is insufficient_data, not a figure", () => {
  const few = answerFromRows(ROWS.filter((r) => r.product === "Cereza"), { product: "cherry" });
  assert.equal(few.status === "insufficient_data" || few.status === "no_matches", true);
  assert.equal(few.price, null);
});

test("cl-odepa-wholesale: an unknown product is an input error before any network call", async () => {
  await assert.rejects(clWholesale({ product: "unobtainium" }, async () => { throw new Error("network must not be used"); }), InputError);
  await assert.rejects(clWholesale({}, async () => ({})), InputError);
});

test("cl-odepa-wholesale: live handler asks datastore_search for the exact product name, newest first", async () => {
  const urls: string[] = [];
  const a = await clWholesale({ product: "cucumber" }, async (u) => { urls.push(u); return { success: true, result: { records: [], fields: [] } }; });
  assert.equal(a.status, "no_matches");
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.match(u.pathname, /datastore_search$/);
  assert.equal(u.searchParams.get("resource_id"), "580beca0-e87e-4dd4-9e8a-0bd92773f4a6");
  assert.deepEqual(JSON.parse(u.searchParams.get("filters")!), { Producto: "Pepino ensalada" });
  assert.equal(u.searchParams.get("sort"), "_id desc");
});

test("cl-odepa-wholesale: harvest stores per-kg national rows with 5+ records", () => {
  const h = harvestFromRows(ROWS, "2026-10-23");
  assert.equal(h.currency, "CLP");
  assert.equal(h.unit, "per kg");
  const t = h.rows.find((r) => r.item === "tomato")!;
  assert.equal(t.area, "ALL");
  assert.equal(t.n, answerFromRows(ROWS, { product: "tomato" }).sample_size);
  assert.ok(!h.rows.some((r) => r.item === "lettuce")); // by the piece, not stored
  assert.throws(() => harvestFromRows([], "2026-10-23"), SourceError);
});

test("cl-odepa-wholesale: collector reads the newest full day", async () => {
  const older = REAL.map((r) => ({ ...r, Fecha: "2026-10-22" }));
  const partial = REAL.slice(0, 3).map((r) => ({ ...r, Fecha: "2026-10-24" })); // a day only just started
  const h = await clHarvest(async () => ({ success: true, result: { records: [...partial, ...REAL, ...older], fields: [] } }));
  assert.equal(h.date, "2026-10-23");
});

test("cl-odepa-wholesale: history key and manifest", () => {
  assert.deepEqual(clHistoryKey({ country: "CL", product: "tomate" }), { area: "ALL", item: "tomato", label: "Chile wholesale tomato" });
  assert.equal(clHistoryKey({ country: "CL", product: "unobtainium" }), null);
  assert.equal(clHistoryKey({ country: "TW", product: "tomato" }), null);
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "cl-odepa-wholesale")!;
  assert.equal(src.category, "wholesale-markets");
  assert.ok(categoryById("wholesale-markets"));
});
