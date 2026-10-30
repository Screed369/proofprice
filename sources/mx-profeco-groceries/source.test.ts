// Tests for the Mexico Profeco source. Column names are copied from the publisher's data dictionary (Diccionario, probed 2026-10-18):
// producto, presentacion, marca, categoria, catalogo, precio, fecha_registro, cadena_comercial, giro, nombre_comercial, direccion, estado, municipio, latitud, longitud.
// The rows are generated in that layout (the monthly CSVs sit inside a RAR the probe cannot open), so a state has 5+ shops.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, Newest, buildRows, decodeText, defsFor, describeBytes, extractYearly, sniff, isoDate, itemKey, matchItems, parseIndex, parsePrices, profecoAnswerFromRows, readHeader, resolveState, splitLine, stateName } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const HEAD = "producto,presentacion,marca,categoria,catalogo,precio,fecha_registro,cadena_comercial,giro,nombre_comercial,direccion,estado,municipio,latitud,longitud";

function csv(): string {
  let t = HEAD + "\n";
  // 8 shops in Jalisco, 6 in Nuevo Leon price milk; 6 in Jalisco price eggs (older prices for the same shop are ignored)
  for (let i = 0; i < 8; i++) t += `"LECHE ULTRAPASTEURIZADA, ENTERA",1 L,LALA,LACTEOS,BASICOS,${(24 + i * 0.5).toFixed(2)},2026-08-${10 + i},CHAIN${i},SUPERMERCADO,SHOP ${i},"CALLE ${i}, COL X",JALISCO,GUADALAJARA,20.6,-103.3\n`;
  for (let i = 0; i < 6; i++) t += `"LECHE ULTRAPASTEURIZADA, ENTERA",1 L,LALA,LACTEOS,BASICOS,${(26 + i * 0.4).toFixed(2)},2026-08-12,NL${i},SUPERMERCADO,NLSHOP ${i},CALLE ${i},NUEVO LEON,MONTERREY,25.6,-100.3\n`;
  for (let i = 0; i < 6; i++) {
    t += `HUEVO BLANCO,18 piezas,SAN JUAN,HUEVO,BASICOS,${(48 + i).toFixed(2)},2026-08-20,CHAIN${i},SUPERMERCADO,SHOP ${i},CALLE ${i},JALISCO,ZAPOPAN,20.7,-103.4\n`;
    t += `HUEVO BLANCO,18 piezas,SAN JUAN,HUEVO,BASICOS,99.00,2026-08-01,CHAIN${i},SUPERMERCADO,SHOP ${i},CALLE ${i},JALISCO,ZAPOPAN,20.7,-103.4\n`;
  }
  t += `HUEVO BLANCO,18 piezas,SAN JUAN,HUEVO,BASICOS,480.00,2026-08-20,CHAINX,SUPERMERCADO,SHOP X,CALLE X,JALISCO,ZAPOPAN,20.7,-103.4\n`; // 10x typo: dropped
  t += `ARROZ,1 kg,X,ARROZ,BASICOS,22.00,2026-08-14,CHAIN1,SUPERMERCADO,SHOP 1,CALLE 1,JALISCO,ZAPOPAN,0,0\n`; // one shop only: not published
  t += `ARROZ,1 kg,X,ARROZ,BASICOS,-5,2026-08-14,CHAIN1,SUPERMERCADO,SHOP 1,CALLE 1,JALISCO,ZAPOPAN,0,0\n`; // junk
  t += `ARROZ,1 kg,X,ARROZ,BASICOS,22.00,not a date,CHAIN1,SUPERMERCADO,SHOP 1,CALLE 1,JALISCO,ZAPOPAN,0,0\n`;
  t += `LECHE ULTRAPASTEURIZADA, ENTERA,1 L,OLD,LACTEOS,BASICOS,30.00,2026-06-01,OLDCHAIN,SUPERMERCADO,OLD,CALLE,JALISCO,ZAPOPAN,0,0\n`; // outside the 30-day window
  return t;
}

function built() {
  const n = new Newest();
  parsePrices(csv(), n);
  return { n, b: buildRows(n.entries(), n.newestDate) };
}

test("header: required columns are found, accents and BOM tolerated, a new layout fails loudly", () => {
  const { idx } = readHeader("﻿Producto,Presentación,marca,categoria,catalogo,precio,fecha_registro,cadena_comercial,giro,nombre_comercial,direccion,estado,municipio,latitud,longitud\n");
  assert.equal(idx.presentacion, 1);
  assert.equal(idx.estado, 11);
  assert.throws(() => readHeader("producto,precio\n1,2\n"), /new layout/);
});

test("helpers: quoted commas, dates, state names, keys, encoding", () => {
  assert.deepEqual(splitLine('"LECHE, ENTERA",1 L,"x ""q"" y"'), ["LECHE, ENTERA", "1 L", 'x "q" y']);
  assert.equal(isoDate("2026-08-14 10:30:00"), "2026-08-14");
  assert.equal(isoDate("4/8/2026"), "2026-08-04");
  assert.equal(isoDate("nope"), "");
  assert.equal(stateName("NUEVO LEON"), "Nuevo Leon");
  assert.equal(itemKey("LECHE, ENTERA|X", " 1 L"), "LECHE/ENTERA X|1 L");
  assert.equal(decodeText(Buffer.from("PIÑA", "latin1")), "PIÑA");
  assert.equal(decodeText(Buffer.from("PIÑA", "utf8")), "PIÑA");
});

test("parse: newest price per shop wins, junk rows are skipped, addresses are not kept", () => {
  const { n } = built();
  assert.equal(n.newestDate, "2026-08-20");
  const e = n.entries();
  assert.ok(!JSON.stringify(e).includes("CALLE"));
  assert.ok(!e.some((x) => x.price === 99)); // older egg price replaced
});

test("aggregate: 30-day window, outlier dropped, 5-shop rule, state and national rows", () => {
  const { b } = built();
  const milkJal = b.rows.find((r) => r.area === "Jalisco" && r.item.startsWith("LECHE"));
  assert.ok(milkJal);
  assert.equal(milkJal.n, 8);
  assert.ok(b.rows.find((r) => r.area === "Nuevo Leon" && r.item.startsWith("LECHE"))!.n === 6);
  assert.equal(b.rows.find((r) => r.area === "ALL" && r.item.startsWith("LECHE"))!.n, 14); // the June price is outside the window
  const egg = b.rows.find((r) => r.area === "ALL" && r.item.startsWith("HUEVO"))!;
  assert.equal(egg.n, 6);
  assert.ok(egg.max < 60); // the 480 typo is gone
  assert.ok(!b.rows.some((r) => r.item.startsWith("ARROZ"))); // one shop only
  assert.equal(b.dropped.outliers, 1);
  assert.deepEqual(b.states, ["Jalisco", "Nuevo Leon"]);
  assert.ok(b.rows.every((r) => r.n >= 5));
});

test("index page: yearly links are read with their hashes, Metadatos and Diccionario ignored", () => {
  const html = `<a href="file.php?t=9d62040eae6dcc63e36b8ac821427647">2026</a> <a href='file.php?t=b9540b181657c2bc7735892091e81f96'><b>2025</b></a>
  <a href="file.php?t=42ed7dad4da507b9d536d9b737e7912d">Metadatos</a> <a href="file.php?t=2de3505b2d37e7db72557a09262d95c7">Diccionario</a>`;
  const l = parseIndex(html);
  assert.deepEqual(l.map((x) => x.year), [2026, 2025]);
  assert.equal(l[0].url, "https://datos.profeco.gob.mx/file.php?t=9d62040eae6dcc63e36b8ac821427647");
});

test("index page: static docs/qqp links of the catalogue (since 27 Oct 2026)", () => {
  const html = `<a class="btn" href="docs/qqp/QQP_2025.rar">Descargar</a>
  <a class="btn" href="docs/qqp/QQP_2026.rar">Descargar</a>
  <a class="btn" href="docs/qqp/QQP_metadatos_dataset.csv">Descargar</a>`;
  const l = parseIndex(html);
  assert.deepEqual(l.map((x) => x.year), [2026, 2025]);
  assert.equal(l[0].url, "https://datos.profeco.gob.mx/docs/qqp/QQP_2026.rar");
});

test("matching: English and Spanish words, shorter names first, state aliases", () => {
  const { b } = built();
  const defs = defsFor(b.rows, "ALL");
  assert.equal(matchItems(defs, "milk")[0].name, "LECHE ULTRAPASTEURIZADA/ENTERA");
  assert.equal(matchItems(defs, "leche")[0].pack, "1 L");
  assert.equal(matchItems(defs, "eggs")[0].name, "HUEVO BLANCO");
  assert.equal(matchItems(defs, "price of the eggs")[0].name, "HUEVO BLANCO");
  assert.equal(matchItems(defs, "rice").length, 0);
  assert.equal(resolveState(b.rows, "nuevo león"), "Nuevo Leon");
  assert.equal(resolveState(b.rows, "Jal"), "Jalisco");
  assert.equal(resolveState(b.rows, "Chiapas"), null);
});

test("answer: national and state figures, posted label, sample size, empty and bad region", () => {
  const { b } = built();
  const day = { date: b.date!, rows: b.rows };
  const a = profecoAnswerFromRows(day, { item: "milk", today: "2026-10-20" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 14);
  assert.equal(a.price!.currency, "MXN");
  assert.equal(a.period.to, "2026-08-20");
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /posted shelf prices/);
  const j = profecoAnswerFromRows(day, { item: "milk", region: "Jalisco", today: "2026-10-20" });
  assert.equal(j.sample_size, 8);
  assert.ok(j.price!.median! > 24 && j.price!.median! < 28);
  const none = profecoAnswerFromRows(day, { item: "caviar", today: "2026-10-20" });
  assert.equal(none.status, "no_matches");
  assert.throws(() => profecoAnswerFromRows(day, { item: "milk", region: "Chiapas" }), /States with figures: Jalisco, Nuevo Leon/);
  assert.throws(() => profecoAnswerFromRows(day, {}), /item is required/);
  const thin = profecoAnswerFromRows(day, { item: "eggs", region: "Nuevo Leon", today: "2026-10-20" });
  assert.equal(thin.status, "no_matches");
});

test("manifest: groceries in Mexico, posted price type, harvest and history key present, examples work", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["MX"]);
  assert.equal(INFO.price_type, "posted_price");
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("MX"));
});

test("sniff: tells a RAR, a zip, a plain CSV and an HTML error page apart, and says so in errors", () => {
  assert.equal(sniff(Buffer.from("Rar!\x1a\x07\x01\x00abc", "latin1")), "rar");
  assert.equal(sniff(Buffer.from([0x50, 0x4b, 3, 4])), "zip");
  assert.equal(sniff(Buffer.from([0x1f, 0x8b, 8, 0])), "gzip");
  assert.equal(sniff(Buffer.from(HEAD + "\n")), "csv");
  assert.equal(sniff(Buffer.from("<!DOCTYPE html><html>")), "html");
  assert.match(describeBytes(Buffer.from("<html>nope")), /10 bytes, type html/);
  assert.throws(() => extractYearly(Buffer.from("<html>nope"), "/tmp", "/tmp/zz-profeco-test", 2026), /not an archive \(10 bytes/);
});

test("unpackWithNodeUnrar reports the library's own message for a file that is not a RAR", { timeout: 180000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { unpackWithNodeUnrar } = await import("./source");
  const d = mkdtempSync(join(tmpdir(), "pf-"));
  const f = join(d, "x.rar"); writeFileSync(f, "not a rar at all");
  assert.throws(() => unpackWithNodeUnrar(f, join(d, "out")), (e: Error) => e.message.length > 0);
});
