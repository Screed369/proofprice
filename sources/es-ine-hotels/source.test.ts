import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { categoryById, countriesFor, paramSchemas } from "../../lib/registry";
import { esHotels, findArea, INFO, isNational, parseName, parseTable, TABLE_REGIONS, TABLE_SITES } from "./source";
import * as F from "./fixtures";

// Fixtures: real INE Tempus responses captured 2026-10-18 (latest month = August 2026).
const fake = (url: string): Promise<unknown> => {
  if (url.includes("/2059")) return Promise.resolve(JSON.parse(F.TABLE_2059));
  if (url.includes("/46298")) return Promise.resolve(JSON.parse(F.TABLE_46298));
  if (url.includes("/2058")) return Promise.resolve(JSON.parse(F.TABLE_2058));
  return Promise.reject(new Error("unexpected url " + url));
};
const o = { get: fake };

test("es-ine-hotels: licence, attribution and type are INE's", () => {
  assert.equal(INFO.id, "es-ine-hotels");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.ok(INFO.attribution.includes("INE"));
  assert.match(INFO.limits, /not a quote/);
});

test("es-ine-hotels: series names in all three layouts", () => {
  assert.deepEqual(parseName("ADR. Andalucía. Datum."), { area: "Andalucía", stars: null, kind: "value" });
  assert.deepEqual(parseName("ADR. National. Interannual variation rate."), { area: "National", stars: null, kind: "variation" });
  assert.deepEqual(parseName("Cádiz. Average Daily Rate (ADR). All categories. Data. "), { area: "Cádiz", stars: null, kind: "value" });
  assert.deepEqual(parseName("Cádiz. Average Daily Rate (ADR). All categories. Annual variation rate. "), { area: "Cádiz", stars: null, kind: "variation" });
  assert.deepEqual(parseName("National. ADR. Five gold stars. Datum."), { area: "National", stars: 5, kind: "value" });
  assert.equal(parseName("Cádiz. Average Daily Rate (ADR). Hotels 4 stars. Data. "), null);
  assert.equal(parseName("Something else entirely"), null);
});

test("es-ine-hotels: reads the real table (euros only, latest month)", () => {
  const s = parseTable(JSON.parse(F.TABLE_2059));
  const nat = s.find((x) => x.area === "National" && x.kind === "value")!;
  assert.equal(nat.value, 166.9);
  assert.equal(nat.year, 2026);
  assert.equal(nat.month, 8);
  assert.equal(s.find((x) => x.area === "Córdoba" && x.kind === "value")!.value, 64.55);
  assert.equal(s.find((x) => x.area === "Córdoba" && x.kind === "variation")!.value, -1.33);
  assert.throws(() => parseTable({ nope: 1 }));
});

test("es-ine-hotels: suppressed and empty points are skipped", () => {
  const bad = [{ COD: "X", Nombre: "ADR. Foo. Datum.", FK_Unidad: 7, Data: [{ Fecha: 1, FK_Periodo: 8, Anyo: 2026, Valor: 100, Secreto: true }, { Fecha: 1, FK_Periodo: 8, Anyo: 2026, Valor: null, Secreto: false }] }];
  assert.deepEqual(parseTable(bad), []);
});

test("es-ine-hotels: place matching ignores accents, prefers the exact name", () => {
  const tables = [
    { id: TABLE_REGIONS, series: parseTable(JSON.parse(F.TABLE_2059)) },
    { id: TABLE_SITES, series: parseTable(JSON.parse(F.TABLE_46298)) },
  ];
  assert.equal(findArea(tables, "cadiz")!.match.value.value, 199.82);
  assert.equal(findArea(tables, "Alicante")!.match.value.value, 155.71);
  assert.equal(findArea(tables, "Benidorm")!.match.table, TABLE_SITES);
  assert.equal(findArea(tables, "andalucia")!.match.variation!.value, 7.1);
  assert.equal(findArea(tables, "Atlantis"), null);
  assert.ok(isNational("España") && isNational("Spain") && !isNational("Madrid"));
});

test("es-ine-hotels: national answer with annual change", async () => {
  const a = await esHotels({}, o);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 166.9);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.match(a.summary, /August 2026/);
  assert.match(a.summary, /7\.32% higher than in August 2025/);
});

test("es-ine-hotels: a city, a region and the stars", async () => {
  const b = await esHotels({ area: "Benidorm" }, o);
  assert.equal(b.price!.value, 175.18);
  assert.match(b.summary, /Benidorm/);
  const c = await esHotels({ area: "Córdoba" }, o);
  assert.equal(c.price!.value, 64.55);
  assert.match(c.summary, /1\.33% lower/);
  const s = await esHotels({ stars: 5 }, o);
  assert.equal(s.price!.value, 357.83);
  assert.match(s.summary, /In August 2026 5-star hotels in Spain charged/);
});

test("es-ine-hotels: bad input says what to do", async () => {
  await assert.rejects(esHotels({ area: "Atlantis" }, o), (e: any) => e instanceof InputError && /Give a region/.test(e.message) && /Benidorm/.test(e.message));
  await assert.rejects(esHotels({ stars: 4, area: "Cádiz" }, o), (e: any) => e instanceof InputError && /Not yet/.test(e.message));
  await assert.rejects(esHotels({ stars: 9 }, o), InputError);
});

test("es-ine-hotels: registered in the hotels category for ES", () => {
  assert.ok(countriesFor("hotels").includes("ES"));
  const schemas = paramSchemas(categoryById("hotels")!);
  assert.ok("area" in schemas && "stars" in schemas);
});
