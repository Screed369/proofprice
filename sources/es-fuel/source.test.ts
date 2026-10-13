import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEsStations, parseEsPrice, esProvinceFromPostcode } from "./source";

// Shape copied from the live Spanish service on 13 Oct 2026 (Soria, province 42).
const esSample = {
  Fecha: "13/10/2026 16:12:37",
  ResultadoConsulta: "OK",
  ListaEESSPrecio: [
    { "C.P.": "42146", "Dirección": "CARRERA N-234, 376,5", IDEESS: "6230", Municipio: "Abejar", "Precio Gasoleo A": "1,945", "Precio Gasolina 95 E5": "1,795", "Rótulo": "REPSOL", "Tipo Venta": "P" },
    { "C.P.": "42100", "Dirección": "POL. INDUSTRIAL LA DEHESA S/N", IDEESS: "8928", Municipio: "Ágreda", "Precio Gasoleo A": "", "Precio Gasolina 95 E5": "1,789", "Rótulo": "EL MAYORIA", "Tipo Venta": "P" },
    { "C.P.": "42100", "Dirección": "COOP", IDEESS: "9999", Municipio: "Ágreda", "Precio Gasoleo A": "1,500", "Rótulo": "COOP", "Tipo Venta": "R" },
  ],
};

test("ES: stations parse, comma decimals, restricted stations excluded", () => {
  assert.equal(parseEsPrice("1,945"), 1.945);
  assert.ok(Number.isNaN(parseEsPrice("")));
  assert.equal(esProvinceFromPostcode("28001"), "28");
  assert.equal(esProvinceFromPostcode("99001"), null);
  const { stations, fecha } = parseEsStations(esSample, "diesel");
  assert.equal(fecha, "13/10/2026 16:12:37");
  assert.equal(stations.length, 1); // empty price dropped, restricted 'R' dropped
  assert.equal(stations[0].price, 1.945);
  assert.equal(parseEsStations(esSample, "petrol95").stations.length, 2);
  assert.throws(() => parseEsStations({}, "diesel"));
});

test("ES: daily library rows by province (IDProvincia, else postcode) plus Spain", async () => {
  const { esDailyRows, esHistoryKey } = await import("./source");
  const withId = { ...esSample, ListaEESSPrecio: [...esSample.ListaEESSPrecio, { "C.P.": "", IDProvincia: "28", "Precio Gasoleo A": "1,600", "Tipo Venta": "P" }] };
  const day = esDailyRows(withId);
  assert.equal(day.date, "2026-10-13");
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  assert.ok(keys.includes("42/diesel/1"));
  assert.ok(keys.includes("28/diesel/1"));
  assert.ok(keys.includes("ALL/diesel/2"));
  assert.ok(keys.includes("42/petrol95/2"));
  assert.deepEqual(esHistoryKey({ postcode: "28001", fuel: "diesel" }), { area: "28", item: "diesel", label: "province 28" });
  assert.equal(esHistoryKey({ fuel: "diesel" })!.area, "ALL");
});

test("ES: live answer keeps its public shape (no library-only fields)", async () => {
  const { esFuelNow } = await import("./source");
  const many = { ...esSample, ListaEESSPrecio: Array.from({ length: 6 }, (_, i) => ({ "C.P.": "42146", IDEESS: String(i), Municipio: "Abejar", "Precio Gasoleo A": `1,9${i}0`, "Rótulo": "X", "Dirección": "A", "Tipo Venta": "P" })) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(many), { status: 200 })) as typeof fetch;
  try {
    const a = await esFuelNow({ area: "42", fuel: "diesel" });
    assert.equal(a.status, "ok");
    const cheapest = (a.extra as any).cheapest_stations;
    assert.deepEqual(Object.keys(cheapest[0]).sort(), ["address", "brand", "id", "postcode", "price", "town"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
