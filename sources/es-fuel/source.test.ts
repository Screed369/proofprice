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
  // placeholders and typing slips are missing values, never a price
  assert.ok(Number.isNaN(parseEsPrice("0,000")));
  assert.ok(Number.isNaN(parseEsPrice("0")));
  assert.ok(Number.isNaN(parseEsPrice("0,019")));
  assert.ok(Number.isNaN(parseEsPrice("19,450")));
  assert.ok(Number.isNaN(parseEsPrice(null)));
  assert.ok(Number.isNaN(parseEsPrice("n/d")));
  const zeros = parseEsStations({ Fecha: "13/10/2026 16:12:37", ListaEESSPrecio: [{ "C.P.": "42146", "Precio Gasoleo A": "0,000", "Tipo Venta": "P" }, { "C.P.": "42146", "Precio Gasoleo A": "1,900", "Tipo Venta": "P" }] }, "diesel");
  assert.deepEqual(zeros.stations.map((s) => s.price), [1.9]);
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
    // posted prices are never described as what people pay; tax status and range definition are stated
    assert.match(a.summary, /current posted pump prices \(taxes included\) have a median of €1\.925 per litre/);
    assert.match(a.summary, /typical range \(10th–90th percentile\)/);
    assert.doesNotMatch(a.summary, /\b(costs?|paid|pays?)\b/i);
    assert.equal(a.price!.unit, "per litre");
    const cheapest = (a.extra as any).cheapest_stations;
    assert.deepEqual(Object.keys(cheapest[0]).sort(), ["address", "brand", "id", "postcode", "price", "town"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("history helpers: url, months, month rows", async () => {
  const { esHistUrl, esMonthsBetween, esMonthRows } = await import("./source");
  assert.match(esHistUrl("2015-01-15"), /EstacionesTerrestresHist\/15-01-2015$/);
  assert.deepEqual(esMonthsBetween("2014-11", "2015-02"), ["2014-11", "2014-12", "2015-01", "2015-02"]);
  assert.equal(esMonthRows({ ListaEESSPrecio: [] }), null);
  const mk = (p: string) => ({ "C.P.": "28001", IDProvincia: "28", "Tipo Venta": "P", "Precio Gasoleo A": p });
  const rows = esMonthRows({ Fecha: "15/01/2015 0:00:00", ListaEESSPrecio: ["1,01", "1,02", "1,03", "1,04", "1,05"].map(mk) });
  const d = rows!.find((r) => r.area === "28" && r.item === "diesel")!;
  assert.equal(d.n, 5);
  assert.equal(d.median, 1.03);
});

test("ES: a thin province (LPG in 42) gets the labelled national figure; no library day means no widening", async () => {
  const { esWidenToNational } = await import("./source");
  const a = esWidenToNational("lpg", "province 42", undefined, new Date("2026-10-22T12:00:00Z"));
  assert.ok(a);
  assert.equal(a!.status, "ok");
  assert.equal((a!.extra as any).widened_to, "mainland Spain and the Balearics");
  assert.match(a!.summary, /Fewer than 5 stations sell .* in province 42, so no local range is published/);
  assert.equal(a!.price!.unit, "per litre");
  const m = esWidenToNational("methane", "province 17", undefined, new Date("2026-10-22T12:00:00Z"));
  assert.equal(m!.price!.unit, "per kg");
  assert.equal(esWidenToNational("lpg", "province 42", undefined, new Date("2026-01-01T12:00:00Z")), null);
});

test("ES: a thin town (LPG) is widened to its province when that has 5+ stations, labelled", async () => {
  const { esFuelNow } = await import("./source");
  const st = (town: string, p: string) => ({ "C.P.": "44001", Localidad: town, IDProvincia: "44", "Tipo Venta": "P", "Precio Gases licuados del petróleo": p, "Dirección": "x", "Rótulo": "y", IDEESS: "1" });
  const list = [st("TERUEL", "0,80"), st("ALCAÑIZ", "0,81"), st("ALCAÑIZ", "0,82"), st("CALAMOCHA", "0,83"), st("MONREAL", "0,84"), st("UTRILLAS", "0,85")];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ Fecha: "22/10/2026 8:00:00", ListaEESSPrecio: list }), { status: 200, headers: { "content-type": "application/json" } })) as any;
  try {
    const a = await esFuelNow({ area: "44", town: "Teruel", fuel: "lpg" });
    assert.equal(a.status, "ok");
    assert.equal((a.extra as any).widened_from, "Teruel");
    assert.equal((a.extra as any).widened_to, "province 44");
    assert.match(a.summary, /Fewer than 5 stations sell .* in Teruel.*province 44 instead/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("ES: every province 01-52 except Ceuta and Melilla belongs to exactly one autonomous community", async () => {
  const { ES_REGIONS, esRegionOf } = await import("./source");
  const all = Object.values(ES_REGIONS).flatMap((r) => r.provinces);
  assert.equal(new Set(all).size, all.length);
  for (let i = 1; i <= 50; i++) assert.ok(esRegionOf(String(i).padStart(2, "0")), `province ${i} has a community`);
  assert.equal(esRegionOf("51"), null);
  assert.equal(esRegionOf("52"), null);
  assert.equal(esRegionOf("42"), "RCL");
});

test("ES: the daily collector writes one row per community next to the province and national rows", async () => {
  const { esDailyRows } = await import("./source");
  const mk = (prov: string, p: string) => ({ "C.P.": prov + "001", IDProvincia: prov, "Tipo Venta": "P", "Precio Gases licuados del petróleo": p });
  // 3 LPG stations in province 42 (Soria) and 3 in 47 (Valladolid): neither province reaches 5, Castile and León does.
  const list = [mk("42", "0,80"), mk("42", "0,81"), mk("42", "0,82"), mk("47", "0,83"), mk("47", "0,84"), mk("47", "0,85")];
  const { rows } = esDailyRows({ Fecha: "29/10/2026 8:00:00", ListaEESSPrecio: list });
  const get = (area: string) => rows.find((r) => r.area === area && r.item === "lpg");
  assert.equal(get("RCL")!.n, 6);
  assert.equal(get("ALL")!.n, 6);
  assert.equal(get("42")!.n, 3);
});

test("ES: widening to a community needs a library row for it; an unknown community or no row means null (national figure follows)", async () => {
  const { esWidenToNational } = await import("./source");
  assert.equal(esWidenToNational("lpg", "province 42", undefined, new Date("2026-10-22T12:00:00Z"), "RXX"), null);
  assert.equal(esWidenToNational("lpg", "province 42", undefined, new Date("2026-10-22T12:00:00Z"), "RCL"), null); // no RCL rows in the library until the next harvest
});

test("ES: G20261029-4 a province code sent as the postcode ('08' / lpg, '30' / methane) answers for the province", async () => {
  const { esFuelNow } = await import("./source");
  const st = (i: number) => ({ "C.P.": "08001", IDProvincia: "08", Municipio: "BARCELONA", "Tipo Venta": "P", "Precio Gases licuados del petróleo": `0,${80 + i}` });
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ Fecha: "29/10/2026 8:00:00", ListaEESSPrecio: [1, 2, 3, 4, 5, 6].map(st) }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  try {
    const a = await esFuelNow({ postcode: "08", fuel: "lpg" });
    assert.equal(a.status, "ok");
    assert.ok(a.sample_size! >= 5);
    assert.match(seen[0], /FiltroProvincia\/08$/);
    assert.match(a.summary, /province 08/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
