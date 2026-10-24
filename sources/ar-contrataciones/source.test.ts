import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, arContracts, arHarvest, awardOf, columnsOf, CsvReader, INFO, isoDate, norm, resolveItem, rubroItems, windowStart, newCounts } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Header and rows copied from the live Adjudicaciones.csv (probe arcontr1, 2026-10-24); values of the newer rows are shaped the same way.
const HEADER =
  "Numero_Proceso,Nro_SAF,Descripcion_SAF,Nro_UOC,Descripcion_UOC,Unidad_Ejecutora,Tipo_de_Procedimiento,Modalidad,Apartado_Directa,Ejercicio,Fecha_de_Adjudicacion,Rubros,CUIT,Descripcion_Proveedor,Documento_Contractual,Tipo,Monto,Moneda,Tipo_de_Operacion,Fecha_de_perfeccionamiento_OC";
const line = (o: { doc: string; date?: string; rubros?: string; tipo?: string; monto?: string; moneda?: string; supplier?: string }) =>
  `23-0019-LPU16,301,"301 - Secretaria General, de la Presidencia de la Nación",23,23/000 - Dirección General de Administración - SG,23/000 - DGA - SG,Licitacion Pública,Sin Modalidad,,2026,${o.date ?? "28/05/2026 04:05:45 p.m."},${o.rubros ?? "INFORMATICA;"},20-23050606-0,${o.supplier ?? "Alfredo Sampedro"},${o.doc},${o.tipo ?? "Original"},${o.monto ?? "1230000.00"},${o.moneda ?? "Peso Argentino"},Proceso de Compra,28/05/2026 12:00:00 a.m.`;
const FROM = "2025-10-24";
const TO = "2026-10-24";

test("CsvReader: quotes with commas, doubled quotes, line breaks inside quotes, CRLF, tiny pieces", () => {
  const text = 'a,"b, c","say ""hi""",d\r\n1,"line1\nline2",,\r\n\r\nlast,row';
  for (const size of [1, 3, 1000]) {
    const rows: string[][] = [];
    const r = new CsvReader((x) => rows.push(x));
    for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
    r.end();
    assert.deepEqual(rows, [["a", "b, c", 'say "hi"', "d"], ["1", "line1\nline2", "", ""], ["last", "row"]], `size ${size}`);
  }
});

test("isoDate reads the Spanish a.m./p.m. stamps and refuses nonsense", () => {
  assert.equal(isoDate("28/12/2016 04:05:45 p.m."), "2016-12-28");
  assert.equal(isoDate("1/2/2026"), "2026-02-01");
  assert.equal(isoDate("31/02/2026 10:00:00 a.m."), "");
  assert.equal(isoDate(""), "");
  assert.equal(isoDate("2026-02-01"), "");
});

test("norm and rubroItems: accents, capitals, dots and the semicolon list", () => {
  assert.equal(norm("MANT. REPARACION Y LIMPIEZA"), "mant reparacion y limpieza");
  assert.equal(norm("Informática"), "informatica");
  assert.deepEqual(rubroItems("ELECTRICIDAD Y TELEFONIA;EQUIPOS;INFORMATICA;REPUESTOS;"), ["r:electricidad y telefonia", "r:equipos", "r:informatica", "r:repuestos"]);
  assert.deepEqual(rubroItems(";;"), []);
});

test("columnsOf finds the needed columns by name and complains when one is missing", () => {
  const cols = columnsOf(HEADER.split(","));
  assert.equal(cols.Monto, 16);
  assert.equal(cols.Rubros, 11);
  assert.throws(() => columnsOf(["a", "b"]), /no column/);
});

function parse(csvLine: string) {
  const rows: string[][] = [];
  const r = new CsvReader((x) => rows.push(x));
  r.push(csvLine + "\n");
  r.end();
  return rows[0];
}
const cols = columnsOf(HEADER.split(","));

test("awardOf: keeps original peso awards; drops dollars, amendments, placeholders, undated, out of window and rows without a product group", () => {
  const ok = awardOf(parse(line({ doc: "23-1004-OC26" })), cols, FROM, TO);
  assert.deepEqual(ok, { key: "23-1004-OC26", date: "2026-05-28", value: 1230000, items: ["r:informatica"] });
  assert.equal(awardOf(parse(line({ doc: "x", moneda: "Dolar Estadounidense" })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", tipo: "Modificación" })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", monto: "12.50" })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", monto: "abc" })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", date: "28/12/2016 04:05:45 p.m." })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", date: "" })), cols, FROM, TO), null);
  assert.equal(awardOf(parse(line({ doc: "x", rubros: "" })), cols, FROM, TO), null);
});

test("awardOf never carries the supplier", () => {
  const a = awardOf(parse(line({ doc: "d1", supplier: "Alfredo Sampedro" })), cols, FROM, TO);
  assert.doesNotMatch(JSON.stringify(a), /Sampedro|20-23050606/);
});

test("aggregateAll: whole country plus every group with 5 distinct awards; an award counts once, and in each of its groups", () => {
  const mk = (n: number, rubros: string, base: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `${rubros}${i}`, date: "2026-03-01", value: base + i, items: rubroItems(rubros) }));
  const five = mk(5, "INFORMATICA;EQUIPOS;", 100000);
  const rows = aggregateAll([...five, five[0], ...mk(4, "ALIMENTOS;", 5000), { key: "old", date: "2020-01-01", value: 9e9, items: ["r:informatica"] }], FROM, TO);
  assert.deepEqual(rows.map((r) => [r.item, r.n]), [["all", 9], ["r:equipos", 5], ["r:informatica", 5]]);
  assert.equal(rows.find((r) => r.item === "r:informatica")!.median, 100002);
});

test("resolveItem: exact group, English word, part of a name, 'all', ambiguity and unknown words", () => {
  const items = ["all", "r:informatica", "r:alimentos", "r:mant reparacion y limpieza", "r:elementos de limpieza", "r:bancos y seguros"];
  assert.equal(resolveItem("Informática", items).item, "r:informatica");
  assert.equal(resolveItem("laptops", items).item, "r:informatica");
  assert.equal(resolveItem("food", items).item, "r:alimentos");
  assert.equal(resolveItem("ALL", items).item, "all");
  assert.equal(resolveItem("seguros", items).item, "r:bancos y seguros");
  assert.throws(() => resolveItem("cleaning", items), /several product groups/);
  assert.throws(() => resolveItem("quantum widgets", items), (e: any) => e instanceof InputError && /informatica/.test(e.message));
});

const bytes = (text: string, chunk = 4000) => async () =>
  (async function* () {
    const b = new TextEncoder().encode(text);
    for (let i = 0; i < b.length; i += chunk) yield b.slice(i, i + chunk); // splits multi-byte letters too
  })();

test("harvest: streams the CSV, keeps aggregates only, notes what it saw; then answers come from the library", async () => {
  const old = line({ doc: "old", date: "28/12/2016 04:05:45 p.m." });
  const lines = [
    ...[1, 2, 3, 4, 5, 6].map((i) => line({ doc: `d${i}`, monto: String(100000 + i * 1000) })),
    line({ doc: "d1", monto: "999999999" }), // same award again: counted once
    line({ doc: "usd", moneda: "Dolar Estadounidense" }),
    line({ doc: "mod", tipo: "Modificación" }),
    ...[1, 2, 3, 4, 5].map((i) => line({ doc: `f${i}`, rubros: "ALIMENTOS;", monto: String(5000 + i) })),
    old,
  ];
  const dir = mkdtempSync(path.join(tmpdir(), "arcontr-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await arHarvest(new Date("2026-10-24T03:17:00Z"), { open: bytes("﻿" + HEADER + "\n" + lines.join("\n") + "\n") });
    assert.equal(h.currency, "ARS");
    assert.equal(h.date, "2026-10-24");
    const inf = h.rows.find((r) => r.item === "r:informatica")!;
    assert.deepEqual([inf.n, inf.median], [6, 103500]);
    assert.equal(h.rows.find((r) => r.item === "all")!.n, 11);
    assert.match(h.note ?? "", /newest award 2026-05-28/);
    assert.match(h.note ?? "", /original \d+/);
    assert.match(h.note ?? "", /dolar estadounidense 1/);
    assert.doesNotMatch(JSON.stringify(h), /Sampedro|20-23050606/);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "ARS", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });

    const a = await arContracts({ what: "computers" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "ARS");
    assert.equal(a.price?.median, 103500);
    assert.equal(a.sample_size, 6);
    // honesty (Gap G20261024-AUDIT-AR-FRESHNESS): the period ends at the newest award in the file, not at the collection day
    assert.deepEqual(a.period, { from: "2025-10-24", to: "2026-05-28" });
    assert.equal((a.extra as any).newest_award, "2026-05-28");
    assert.match(a.method, /2025-10-24 to 2026-05-28/);
    assert.ok(h.rows.some((r) => r.item === "newest:2026-05-28" && Number.isNaN(r.n)), "marker row carries the newest award date and no count");
    assert.ok(!h.rows.some((r) => r.item.startsWith("r:newest")), "the marker is never a product group");
    assert.match(a.summary, /not unit prices/);
    assert.equal((await arContracts({ what: "all" })).sample_size, 11);
    assert.equal((await arContracts({ what: "alimentos" })).sample_size, 5);
    await assert.rejects(arContracts({ what: "ships" }), InputError);
    await assert.rejects(arContracts({ what: "all", cpv: "30" }), InputError);
    await assert.rejects(arContracts({ what: "all", buyer_area: "Salta" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest errors: format change, empty file, nothing usable (with what it saw), unreadable file", async () => {
  const now = new Date("2026-10-24T03:17:00Z");
  await assert.rejects(arHarvest(now, { open: bytes("a,b\n1,2\n") }), /no column/);
  await assert.rejects(arHarvest(now, { open: bytes("") }), /empty/);
  const stale = HEADER + "\n" + line({ doc: "a", date: "01/03/2026 10:00:00 a.m.", moneda: "Dolar Estadounidense" }) + "\n";
  await assert.rejects(arHarvest(now, { open: bytes(stale) }), /no usable awards in the window \(rows in window by type: original 1; by currency: dolar estadounidense 1\)/);
  await assert.rejects(arHarvest(now, { open: async () => Promise.reject(new Error("socket hang up")) }), (e: any) => e instanceof SourceError && /Could not read the COMPR.AR file/.test(e.message));
});

test("no library yet gives a readable error; window is 12 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "arcontr-empty-"));
  try {
    await assert.rejects(arContracts({ what: "all" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-24"), "2025-10-24");
  assert.equal(newCounts().rows, 0);
});

test("INFO: CC BY 4.0, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /tax numbers in the open file are never read/);
  assert.match(INFO.attribution, /COMPR\.AR/);
});
