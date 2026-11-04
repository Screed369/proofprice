// Fixtures: fixtures/he3q-86dn-2026-10.json = rows copied on 2026-10-29 from https://www.datos.gov.co/resource/he3q-86dn.json (same columns and string
// values as the live reply; the Bogota and Medellin rows are real, a few filler stations and one zero-price row were added so that an area reaches
// 5 stations and the filter is exercised). fixtures/months.json = the shape of the grouped month list (live: 2026-9 and 2026-10 both exist).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { coFuel, coHistoryKey, harvestFromStations, monthsUrl, newestMonth, parseStations, resolveScope, answerFromStations, stationsUrl } from "./source";

const ROWS = JSON.parse(readFileSync(new URL("./fixtures/he3q-86dn-2026-10.json", import.meta.url), "utf8"));
const MONTHS = JSON.parse(readFileSync(new URL("./fixtures/months.json", import.meta.url), "utf8"));

test("co-fuel: newest month is found by number, not by text (2026-10 is after 2026-9)", () => {
  assert.deepEqual(newestMonth(MONTHS), { year: 2026, month: 10 });
  assert.throws(() => newestMonth([]), SourceError);
  assert.throws(() => newestMonth({ x: 1 }), SourceError);
});

test("co-fuel: stations drop zero prices and keep accents out of the keys", () => {
  const s = parseStations(ROWS);
  assert.equal(s.length, 9);
  assert.ok(s.some((x) => x.municipality === "BOGOTA D C" && x.department === "BOGOTA D C"));
  assert.ok(s.some((x) => x.municipality === "DOSQUEBRADAS"));
  assert.throws(() => parseStations({ error: 1 }), SourceError);
});

test("co-fuel: national answer is a posted COP per cubic metre median with a sample size", () => {
  const st = parseStations(ROWS);
  const a = answerFromStations(st, 2026, 10, { fuel: "methane" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "COP");
  assert.equal(a.price!.unit, "per cubic metre");
  assert.equal(a.sample_size, 9);
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.period.from, "2026-10-01");
  assert.match(a.source.licence, /ShareAlike/);
  assert.match(a.summary, /2026-10/);
});

test("co-fuel: a department or town with under 5 stations gets no figure; Bogota has 5", () => {
  const st = parseStations(ROWS);
  assert.equal(answerFromStations(st, 2026, 10, { fuel: "methane", town: "Bogotá" }).status, "ok");
  assert.equal(answerFromStations(st, 2026, 10, { fuel: "methane", area: "Antioquia" }).status, "insufficient_data");
  assert.equal(answerFromStations(st, 2026, 10, { fuel: "methane", town: "Medellin" }).price, null);
  assert.equal(resolveScope({ area: "Valle del Cauca" }, st).kind, "department");
});

test("co-fuel: other fuels are input errors", async () => {
  await assert.rejects(coFuel({ fuel: "diesel" }), InputError);
  assert.throws(() => answerFromStations([], 2026, 10, { fuel: "petrol95" }), InputError);
});

test("co-fuel: coFuel asks for the month list, then the newest month", async () => {
  const urls: string[] = [];
  const a = await coFuel({ fuel: "methane" }, async (u) => {
    urls.push(u);
    return u === monthsUrl() ? MONTHS : ROWS;
  });
  assert.equal(a.status, "ok");
  assert.equal(urls[1], stationsUrl(2026, 10));
});

test("co-fuel: harvest stores national plus areas with at least 5 stations, dated the first of the month", () => {
  const h = harvestFromStations(parseStations(ROWS), 2026, 10);
  assert.equal(h.date, "2026-10-01");
  assert.equal(h.currency, "COP");
  assert.ok(h.rows.every((r) => r.n >= 5 && r.item === "methane"));
  assert.deepEqual(h.rows.map((r) => r.area).sort(), ["ALL", "dep:BOGOTA D C", "mun:BOGOTA D C"]);
  assert.throws(() => harvestFromStations(parseStations(ROWS).slice(0, 3), 2026, 10), SourceError);
});

test("co-fuel: history keys match the harvest keys", () => {
  assert.deepEqual(coHistoryKey({ fuel: "methane" })!.area, "ALL");
  assert.equal(coHistoryKey({ fuel: "methane", area: "Antioquia" })!.area, "dep:ANTIOQUIA");
  assert.equal(coHistoryKey({ fuel: "methane", town: "Medellín" })!.area, "mun:MEDELLIN");
  assert.equal(coHistoryKey({ fuel: "diesel" }), null);
});

// Gap G20261104-1: area "antioquia" (lowercase) + fuel=methane answered no_matches on 2026-11-04 because the newest month (2026-11) was only
// partly reported (56 stations, none in Antioquia). The answer now falls back to the latest month where the asked area has 5+ stations.
test("co-fuel: lowercase 'antioquia' falls back to the previous month when the newest month has no Antioquia stations yet", async () => {
  const row = (y: number, m: number, dep: string, mun: string, price: number) => ({
    fecha_precio: `${y}-${m}-01`, anio_precio: String(y), mes_precio: String(m), departamento_eds: dep, municipio_eds: mun,
    precio_promedio_publicado: String(price), tipo_combustible: "GNCV",
  });
  const nov = Array.from({ length: 6 }, (_, i) => row(2026, 11, "BOGOTA D.C.", "BOGOTA, D.C.", 3600 + i));
  const oct = [
    ...Array.from({ length: 5 }, (_, i) => row(2026, 10, "ANTIOQUIA", "MEDELLIN", 3500 + i * 10)),
    ...nov.map((r) => ({ ...r, mes_precio: "10", fecha_precio: "2026-10-01" })),
  ];
  const months = [{ anio_precio: "2026", mes_precio: "10", n: "11" }, { anio_precio: "2026", mes_precio: "11", n: "6" }];
  const fetcher = async (url: string) => {
    if (url === monthsUrl()) return months;
    if (url === stationsUrl(2026, 11)) return nov;
    if (url === stationsUrl(2026, 10)) return oct;
    return [];
  };
  const a = await coFuel({ fuel: "methane", area: "antioquia" }, fetcher);
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 5);
  assert.equal(a.period.from, "2026-10-01");
  assert.match(a.summary, /Antioquia/);
  // the whole country still uses the newest month when it has enough stations
  const n = await coFuel({ fuel: "methane" }, fetcher);
  assert.equal(n.period.from, "2026-11-01");
});
