// Tests for the Argentina SEPA source. fixture-store.zip is a REAL chain file copied from the publisher's sepa_jueves.zip (snapshot folder 2026-10-29, chain 4, one branch in
// Ciudad de Buenos Aires); columns are pipe separated, with a BOM and a trailing "Ultima actualizacion" line. The outer weekday zip is rebuilt here as a stored zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { INFO, Collector, bestName, buildRows, bufferReader, eachLine, matchItems, packFromName, packLabel, parseBranches, parsePackage, parseProducts, provinceName, readStoreZip, resolveProvince, sepaAnswerFromRows, defsFor, tidyName, zipEntries, zipRead } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";
import { NATIONAL } from "../../lib/library/aggregate";

const FIXTURE = readFileSync(new URL("./fixture-store.zip", import.meta.url));

/** A tiny zip writer (stored or deflated) so the test can build the outer weekday file. */
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

const HEAD = "id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|productos_unidad_medida_presentacion|productos_marca|productos_precio_lista|productos_precio_referencia|productos_cantidad_referencia|productos_unidad_medida_referencia|productos_precio_unitario_promo1|productos_leyenda_promo1|productos_precio_unitario_promo2|productos_leyenda_promo2";
const SUC_HEAD = "id_comercio|id_bandera|id_sucursal|sucursales_nombre|sucursales_tipo|sucursales_calle|sucursales_numero|sucursales_latitud|sucursales_longitud|sucursales_observaciones|sucursales_barrio|sucursales_codigo_postal|sucursales_localidad|sucursales_provincia";

/** A synthetic chain file in the real layout: `n` branches in the given province code, each pricing the given products. */
function chain(id: number, prov: string, branches: number, products: { code: string; name: string; price: (b: number) => number }[]): { branches: string; products: string } {
  let suc = SUC_HEAD + "\n", prod = HEAD + "\n";
  for (let b = 1; b <= branches; b++) {
    suc += `${id}|1|${b}|SHOP ${b}|Supermercado|CALLE|1|0|0||X|1000|CIUDAD|${prov}\n`;
    for (const p of products) prod += `${id}|1|${b}|${p.code}|1|${p.name}|1.00|unidad| |${p.price(b).toFixed(2)}|0|1|unidad||||\n`;
  }
  return { branches: suc + " \nUltima actualizacion: 2026-10-28T16:00:00-03:00\n", products: prod + " \nUltima actualizacion: 2026-10-28T16:00:00-03:00\n" };
}

function collected(): Collector {
  const c = new Collector();
  const milk = [{ code: "7790742000001", name: "LECHE UAT ENTERA LA SERENISIMA X1L", price: (b: number) => 3000 + b * 10 }, { code: "7790742000002", name: "LECHE FERMENTADA MULTIFRUTA ACTIMEL X 100 CC", price: () => 2200 }];
  const rice = [{ code: "7790742000003", name: "ARROZ PARBOIL GALLO ORO BOLSA X 500 GRS PAQ-500-gr", price: (b: number) => (b === 1 ? 99999 : 1500 + b) }];
  for (const [id, prov, n] of [[1, "AR-X", 7], [2, "AR-C", 6], [3, "AR-M", 3]] as [number, string, number][]) {
    const ch = chain(id, prov, n, [...milk, ...rice]);
    parseProducts(Buffer.from(ch.products), parseBranches(ch.branches), c);
  }
  c.newestDate = "2026-10-29";
  return c;
}

test("zip: central directory read, stored and deflated entries, cut-short archives fail loudly", () => {
  const zip = makeZip([{ name: "2026-10-29/", data: Buffer.alloc(0) }, { name: "2026-10-29/a.zip", data: FIXTURE }, { name: "2026-10-29/b.txt", data: Buffer.from("hola ".repeat(50)), deflate: true }]);
  const read = bufferReader(zip);
  const es = zipEntries(read, zip.length);
  assert.deepEqual(es.map((e) => e.name), ["2026-10-29/", "2026-10-29/a.zip", "2026-10-29/b.txt"]);
  assert.equal(zipRead(read, es[1]).length, FIXTURE.length);
  assert.equal(zipRead(read, es[2]).toString(), "hola ".repeat(50));
  assert.throws(() => zipEntries(bufferReader(zip.subarray(0, zip.length - 40)), zip.length - 40), /central directory/);
  assert.throws(() => zipEntries(bufferReader(zip.subarray(0, 100)), 100), /central directory/);
});

test("real chain file: provinces from sucursales.csv, EAN products only, BOM and trailer tolerated", () => {
  const c = new Collector();
  readStoreZip(FIXTURE, c);
  assert.equal(c.stores, 1);
  assert.ok(c.kept > 5, "rows kept");
  assert.ok(c.drops.ean >= 1, "the non-EAN razor row and the trailer are dropped");
  const sprite = c.products.get("7791813434412")!;
  assert.ok(sprite, "7UP row read by barcode");
  assert.equal(c.provinces[c.prov[0]], "Ciudad de Buenos Aires");
  assert.equal(c.price[0], 4700);
  assert.equal(c.products.has("0000000023897"), false);
});

test("helpers: provinces, packs, names, line reader, encodings", () => {
  assert.equal(provinceName("AR-B"), "Buenos Aires");
  assert.equal(provinceName("CAPITAL FEDERAL"), "Ciudad de Buenos Aires");
  assert.equal(provinceName("Atlantis"), "");
  assert.equal(provinceName("CABA"), "Ciudad de Buenos Aires");
  assert.equal(provinceName("Cordoba"), "Cordoba");
  assert.equal(provinceName(""), "");
  assert.equal(packLabel("00250", "gr"), "250 g");
  assert.equal(packLabel("1.00", "LT"), "1 L");
  assert.equal(packLabel("1.00", "unidad"), "");
  assert.equal(packFromName("LECHE UAT LA SERENISIMA X1L"), "1 L");
  assert.equal(packFromName("FIDEOS TALLARIN N5 LUCCHETTI X 500 GRS"), "500 g");
  assert.equal(packFromName("ACEITE GIRASOL NATURA PET X 900 CC"), "900 ml");
  assert.equal(packFromName("Pan blanco LACTAL x 315g"), "315 g");
  assert.equal(packFromName("Huevos blancos CARNAVE docena"), "12 units");
  assert.equal(packFromName("HUEVOS BLANCOS GRANDES GRANJA ALMEYRA CARTON X 6 U"), "6 units");
  assert.equal(packFromName("HUEVOS FRES BCO GDE"), "");
  assert.equal(tidyName("  ..Yerba Mate PLAYADITO Suave x500gr PAQ-500-gr. "), "Yerba Mate PLAYADITO Suave x500gr");
  assert.equal(bestName(new Map([["LECHE", 50], ["LECHE UAT ENTERA LA SERENISIMA X1L", 30], ["L UAT", 1]])), "LECHE UAT ENTERA LA SERENISIMA X1L");
  const seen: string[] = [];
  eachLine(Buffer.from("a|b\r\n\r\nc|d\ne|f"), (l, first) => seen.push(`${first ? "H" : ""}${l}`));
  assert.deepEqual(seen, ["Ha|b", "c|d", "e|f"]);
  const latin = Buffer.from("PIÑA|x\nPIÑA|y", "latin1");
  const got: string[] = [];
  eachLine(latin, (l) => got.push(l));
  assert.equal(got[0], "PIÑA|x");
});

test("catalogue: weekday zip resources are found, a changed layout fails loudly", () => {
  const out = parsePackage({ result: { resources: [{ name: "Jueves", url: "https://datos.produccion.gob.ar/x/download/sepa_jueves.zip" }, { name: "Provincias", url: "https://x/maestro-provincias.xlsx" }] } });
  assert.deepEqual(out.map((o) => o.name), ["Jueves"]);
  assert.throws(() => parsePackage({ result: { resources: [] } }), /no sepa/);
  assert.throws(() => parsePackage({}), /no resources/);
});

test("rows: median and range per province and product, 5-shop minimum, outlier typo dropped, national row added", () => {
  const b = buildRows(collected(), "2026-10-29");
  assert.equal(b.date, "2026-10-29");
  const milk = b.rows.filter((r) => r.item.startsWith("LECHE UAT ENTERA"));
  assert.ok(milk.every((r) => r.item === "LECHE UAT ENTERA LA SERENISIMA X1L|1 L"));
  const nat = milk.find((r) => r.area === NATIONAL)!;
  assert.equal(nat.n, 16); // 7 + 6 + 3 shops
  const cba = milk.find((r) => r.area === "Cordoba")!;
  assert.equal(cba.n, 7);
  assert.equal(cba.median, 3040);
  assert.ok(!milk.some((r) => r.area === "Mendoza"), "3 shops in Mendoza: not published");
  const rice = b.rows.find((r) => r.item.startsWith("ARROZ") && r.area === "Cordoba")!;
  assert.equal(rice.n, 6, "the 99999 entry error is dropped");
  assert.equal(rice.item, "ARROZ PARBOIL GALLO ORO BOLSA X 500 GRS|500 g");
  assert.equal(b.dropped.outliers, 3, "one 99999 entry per chain");
  assert.ok(b.provinces.includes("Ciudad de Buenos Aires"));
  assert.ok(b.rows.every((r) => r.n >= 5));
});

test("matching: English and Spanish, the product noun first, specialty variants rank lower", () => {
  const rows = buildRows(collected(), "2026-10-29").rows;
  const defs = defsFor(rows, NATIONAL);
  assert.equal(matchItems(defs, "milk")[0].name, "LECHE UAT ENTERA LA SERENISIMA X1L");
  assert.equal(matchItems(defs, "leche")[0].name, "LECHE UAT ENTERA LA SERENISIMA X1L");
  assert.equal(matchItems(defs, "rice")[0].pack, "500 g");
  assert.equal(matchItems(defs, "caviar").length, 0);
  assert.equal(resolveProvince(rows, "CORDOBA"), "Cordoba");
  assert.equal(resolveProvince(rows, "Mendoza"), null);
});

test("answer: posted-price range with shops, period, licence and attribution; region, unknown item and bad input", () => {
  const day = { date: "2026-10-29", rows: buildRows(collected(), "2026-10-29").rows };
  const a = sepaAnswerFromRows(day, { item: "milk", today: "2026-11-05" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 16);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "ARS");
  assert.equal(a.period?.to, "2026-10-29");
  assert.equal(a.source.id, "ar-sepa-groceries");
  assert.match(a.source.attribution, /CC BY 2\.5 AR/);
  const r = sepaAnswerFromRows(day, { item: "milk", region: "córdoba", today: "2026-11-05" });
  assert.equal(r.sample_size, 7);
  assert.throws(() => sepaAnswerFromRows(day, { item: "milk", region: "Mendoza" }), /Provinces with figures/);
  assert.throws(() => sepaAnswerFromRows(day, { item: "" }), /item is required/);
  const none = sepaAnswerFromRows(day, { item: "caviar", today: "2026-11-05" });
  assert.equal(none.status, "no_matches");
  const old = sepaAnswerFromRows(day, { item: "milk", today: "2026-12-30" });
  assert.equal(old.extra?.publisher_data_old, true);
});

test("manifest: groceries tool, AR only, examples answer from the registry", () => {
  assert.equal(manifest.info.id, INFO.id);
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["AR"]);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("AR"));
  assert.ok(manifest.harvest && manifest.historyKey);
});
