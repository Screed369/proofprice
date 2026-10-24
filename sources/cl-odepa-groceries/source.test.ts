// Tests for the Chile ODEPA source. Record layout and the first three rows are copied from the live CKAN datastore_search answer
// (resource 9f885df4-afeb-4b75-8bab-9334f79db00f, "Detalle de Precios Consumidor año 2026"), checked 2026-10-24: every value is text, the average uses a decimal comma.
// The other rows are generated in that layout so several sectors and regions reach the 5-point rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, Newest, buildRows, defsFor, itemKey, matchItems, odepaAnswerFromRows, parseNumber, readRecords, regionName, resolveRegion, unitPhrase, weeksToRead, yearTables } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const base = { Anio: "2026", Mes: "10", Semana: "43", "Fecha inicio": "2026-10-19", "Fecha termino": "2026-10-23" };
const REAL = [
  { ...base, "ID region": "16", Region: "Región de Ñuble", Sector: "Punilla", "Tipo de punto monitoreo": "Supermercado", Grupo: "Pan", Producto: "Pan amasado", Unidad: "$/kilo", "Precio minimo": "2850", "Precio maximo": "3450", "Precio promedio": "3150,000000" },
  { ...base, "ID region": "16", Region: "Región de Ñuble", Sector: "Punilla", "Tipo de punto monitoreo": "Supermercado", Grupo: "Pan", Producto: "Marraqueta", Unidad: "$/kilo", "Precio minimo": "1890", "Precio maximo": "2190", "Precio promedio": "2090,000000" },
  { ...base, "ID region": "16", Region: "Región de Ñuble", Sector: "Punilla", "Tipo de punto monitoreo": "Supermercado", Grupo: "Lácteos - Huevos - Margarinas", Producto: "Leche Fluida Entera", Unidad: "$/Caja de 1 Litro", "Precio minimo": "1000", "Precio maximo": "1190", "Precio promedio": "1090,000000" },
];

function rec(region: string, sector: string, shop: string, product: string, unit: string, avg: number, date = "2026-10-19") {
  return { ...base, "Fecha inicio": date, Region: region, Sector: sector, "Tipo de punto monitoreo": shop, Grupo: "x", Producto: product, Unidad: unit, "Precio minimo": String(avg - 50), "Precio maximo": String(avg + 50), "Precio promedio": `${avg},000000` };
}

function records() {
  const out: Record<string, any>[] = [...REAL];
  // milk: 6 points in Metropolitana, 5 in Ñuble (the real Punilla row is one of them)
  for (let i = 0; i < 6; i++) out.push(rec("Región Metropolitana de Santiago", `Sector ${i}`, "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 1000 + i * 20));
  for (let i = 0; i < 4; i++) out.push(rec("Región de Ñuble", `Sector ${i}`, "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 1050 + i * 10));
  // an older week for the same point is replaced by the newer one
  out.push(rec("Región Metropolitana de Santiago", "Sector 0", "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 900, "2026-10-12"));
  // an entry error (10x) is dropped
  out.push(rec("Región Metropolitana de Santiago", "Sector 9", "Feria libre", "Leche Fluida Entera", "$/Caja de 1 Litro", 10900));
  // eggs: 5 points in Metropolitana only; vegetable name with bars; a product at 2 points only (not published)
  for (let i = 0; i < 5; i++) out.push(rec("Región Metropolitana de Santiago", `Sector ${i}`, "Feria libre", "Huevo color grande (primera)", "$/bandeja 12 unidades", 3500 + i * 100));
  for (let i = 0; i < 6; i++) out.push(rec("Región de Valparaíso", `Sector ${i}`, "Feria libre", "Tomate|Larga vida|Primera", "$/kilo", 1500 + i * 50));
  for (let i = 0; i < 2; i++) out.push(rec("Región del Biobío", `Sector ${i}`, "Supermercado", "Caviar", "$/kilo", 90000));
  // junk and a week outside the 4-week window
  out.push(rec("Región de Ñuble", "Sector J", "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 0));
  out.push({ ...rec("Región de Ñuble", "Sector K", "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 1111), "Precio promedio": "" });
  out.push(rec("Región de Ñuble", "Sector Old", "Supermercado", "Leche Fluida Entera", "$/Caja de 1 Litro", 800, "2026-08-03"));
  return out;
}

function built() {
  const n = new Newest();
  readRecords(records(), n);
  return { n, b: buildRows(n.entries(), n.newestWeek) };
}

test("helpers: decimal comma, region names, item keys, units, year tables, weeks across a year end", () => {
  assert.equal(parseNumber("3150,000000"), 3150);
  assert.equal(parseNumber("2850"), 2850);
  assert.ok(Number.isNaN(parseNumber("")));
  assert.equal(regionName("Región de Ñuble"), "Ñuble");
  assert.equal(regionName("Región Metropolitana de Santiago"), "Metropolitana de Santiago");
  assert.equal(regionName("Región del Biobío"), "Biobío");
  assert.equal(itemKey("Palta|Hass|Primera", "$/kilo"), "Palta / Hass / Primera|$/kilo");
  assert.equal(unitPhrase("$/Caja de 1 Litro"), "Caja de 1 Litro");
  const t = yearTables([
    { id: "a", name: "Detalle de Precios Consumidor año 2025", datastoreActive: true },
    { id: "b", name: "Detalle de Precios Consumidor año 2026", datastoreActive: true },
    { id: "c", name: "Diccionario", datastoreActive: false },
  ]);
  assert.deepEqual(t.map((x) => x.id), ["b", "a"]);
  assert.deepEqual(weeksToRead(2026, 43).map((w) => w.week), [43, 42, 41, 40]);
  assert.deepEqual(weeksToRead(2026, 2), [{ year: 2026, week: 2 }, { year: 2026, week: 1 }, { year: 2025, week: 52 }, { year: 2025, week: 51 }]);
});

test("parse: newest week per monitored point wins, junk skipped", () => {
  const { n } = built();
  assert.equal(n.newestWeek, "2026-10-19");
  assert.ok(!n.entries().some((e) => e.price === 900 || e.price === 0));
});

test("aggregate: 4-week window, outlier dropped, 5-point rule, region and national rows", () => {
  const { b } = built();
  assert.equal(b.date, "2026-10-23"); // Friday of the newest week
  const milkRm = b.rows.find((r) => r.area === "Metropolitana de Santiago" && r.item.startsWith("Leche"));
  assert.ok(milkRm);
  assert.equal(milkRm.n, 6);
  assert.equal(b.rows.find((r) => r.area === "Ñuble" && r.item.startsWith("Leche"))!.n, 5); // the real Punilla row + 4 generated; the August point is outside the window
  assert.equal(b.rows.find((r) => r.area === "ALL" && r.item.startsWith("Leche"))!.n, 11);
  assert.equal(b.dropped.outliers, 1);
  assert.ok(!b.rows.some((r) => r.item.startsWith("Caviar")));
  assert.ok(b.rows.every((r) => r.n >= 5));
  assert.ok(b.rows.some((r) => r.item === "Tomate / Larga vida / Primera|$/kilo"));
  assert.deepEqual(b.regions, ["Metropolitana de Santiago", "Valparaíso", "Ñuble"].sort());
});

test("matching: English and Spanish words, shorter names first, region aliases", () => {
  const { b } = built();
  const defs = defsFor(b.rows, "ALL");
  assert.equal(matchItems(defs, "milk")[0].name, "Leche Fluida Entera");
  assert.equal(matchItems(defs, "leche")[0].unit, "$/Caja de 1 Litro");
  assert.equal(matchItems(defs, "eggs")[0].name, "Huevo color grande (primera)");
  assert.equal(matchItems(defs, "tomato")[0].name, "Tomate / Larga vida / Primera");
  assert.equal(matchItems(defs, "caviar").length, 0);
  assert.equal(resolveRegion(b.rows, "Metropolitana"), "Metropolitana de Santiago");
  assert.equal(resolveRegion(b.rows, "Santiago"), "Metropolitana de Santiago");
  assert.equal(resolveRegion(b.rows, "Región de Ñuble"), "Ñuble");
  assert.equal(resolveRegion(b.rows, "Valparaiso"), "Valparaíso");
  assert.equal(resolveRegion(b.rows, "Magallanes"), null);
});

test("answer: posted label, sample size counts monitored points, empty and bad region", () => {
  const { b } = built();
  const day = { date: b.date!, rows: b.rows };
  const a = odepaAnswerFromRows(day, { item: "milk", today: "2026-10-24" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 11);
  assert.equal(a.price!.currency, "CLP");
  assert.equal(a.period.to, "2026-10-23");
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /posted shelf prices/);
  assert.match(a.price!.unit, /Caja de 1 Litro/);
  const rm = odepaAnswerFromRows(day, { item: "milk", region: "Metropolitana", today: "2026-10-24" });
  assert.equal(rm.sample_size, 6);
  assert.ok(rm.price!.median! > 1000 && rm.price!.median! < 1120);
  const none = odepaAnswerFromRows(day, { item: "caviar", today: "2026-10-24" });
  assert.equal(none.status, "no_matches");
  assert.throws(() => odepaAnswerFromRows(day, { item: "milk", region: "Magallanes" }), /Regions with figures: /);
  assert.throws(() => odepaAnswerFromRows(day, {}), /item is required/);
  const thin = odepaAnswerFromRows(day, { item: "eggs", region: "Valparaiso", today: "2026-10-24" });
  assert.equal(thin.status, "no_matches");
  const old = odepaAnswerFromRows(day, { item: "milk", today: "2026-12-30" });
  assert.equal((old.extra as any).stale, true);
});

test("manifest: groceries in Chile, posted price type, harvest and history key present", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["CL"]);
  assert.equal(INFO.price_type, "posted_price");
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("CL"));
});
