// Tests for the Uruguay consumer-ministry shelf prices (SIPC). Fixtures in ./fixtures are slices of the REAL files checked on 2026-11-11:
// productos.csv and establecimiento.csv (semicolons, Windows-1252), and the tail of precios_2026.csv read with a Range request (comma CSV, newest day 2026-09-30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { INFO, Newest, buildRows, decodeLatin, defsFor, downloadTail, itemKey, matchItems, norm, parsePrices, parseProducts, parseShops, pickFiles, resolveArea, splitComma, uyAnswerFromRows, uyHarvest, uyHistoryKey } from "./source";
import manifest from "./index";
import { NATIONAL } from "../../lib/library/aggregate";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n));
const products = parseProducts(decodeLatin(fx("productos.csv")));
const shops = parseShops(decodeLatin(fx("establecimiento.csv")));

test("products and shops: Windows-1252 accents decode, brand is dropped, only id and department are read", () => {
  assert.equal(products.size, 7);
  assert.deepEqual(products.get(4), { name: "Aceite de maíz", pack: "Envase 900 cc" });
  assert.equal(itemKey(products.get(1)!), "Aceite de girasol|Envase 900 cc");
  assert.equal(shops.size, 11);
  assert.equal(shops.get(1), "Montevideo");
  assert.ok(![...shops.values()].some((v) => /AVDA|S\.A\./.test(v)), "no addresses or company names");
  assert.throws(() => parseProducts("a;b;c\n1;2;3"), /changed shape/);
  assert.throws(() => parseShops("a;b\n1;2"), /changed shape/);
});

test("splitComma handles quoted fields", () => {
  assert.deepEqual(splitComma('1,"a,b",\\N'), ["1", "a,b", "\\N"]);
});

test("price rows: the real tail starts mid-row; the cut line is dropped, the header is found, rows parse", () => {
  const text = fx("precios-tail.csv").toString("utf8");
  assert.ok(text.startsWith(",1682,"), "fixture begins with a cut fragment like a Range read");
  const map = new Map(products);
  map.set(126, { name: "Pasta dental", pack: "Unidad 90 grs." });
  map.set(125, { name: "Pasta dental", pack: "Unidad 90 grs." });
  const allShops = new Map<number, string>();
  for (let i = 500; i < 540; i++) allShops.set(i, "Montevideo");
  const n = new Newest();
  const st = parsePrices(text, map, allShops, n);
  assert.equal(st.rows, 40);
  assert.ok(st.kept >= 2 && st.kept < 40, "only known products are kept");
  assert.ok(st.unknownProduct > 0);
  assert.equal(n.newestDate, "2026-09-22");
});

const line = (id: number, date: string, offer: number, price: number, shop: string, feria: string, prod: number) => `${id},${date} 06:00:00,${date},"\\N",${offer},${price},"\\N","\\N",${shop},${feria},${prod}`;
const HEAD = '"ID_PrecioDiario","Declaracion","Fecha","Fecha_anterior","Oferta","Precio","PrecioAnterior","Publico","Establecimiento","Feria_id","Presentacion_Producto"';
const rice = new Map([[15, { name: "Arroz blanco", pack: "Bolsa 1 kg." }], [16, { name: "Arroz blanco", pack: "Bolsa 1 kg." }], [24, { name: "Azúcar blanco", pack: "Paquete 1 kg." }]]);
const shopMap = new Map<number, string>();
for (let i = 1; i <= 13; i++) shopMap.set(i, i <= 7 || i === 13 ? "Montevideo" : "Canelones");

function sample(): Newest {
  const rows = ["cut,fragment", HEAD];
  let id = 1;
  const prices = [60, 62, 64, 65, 66, 68, 70, 72, 74, 76, 78, 80];
  for (let s = 1; s <= 12; s++) {
    rows.push(line(id++, "2026-09-25", 0, 500, String(s), '"\\N"', 15)); // old price, replaced by the newer one
    rows.push(line(id++, "2026-09-30", 0, prices[s - 1], String(s), '"\\N"', s % 2 ? 15 : 16));
    rows.push(line(id++, "2026-09-30", 0, 40 + s, String(s), '"\\N"', 24));
  }
  rows.push(line(id++, "2026-09-30", 1, 10, "1", '"\\N"', 15)); // an offer: ignored
  rows.push(line(id++, "2026-09-30", 0, 900, "13", '"\\N"', 24)); // outlier for sugar: dropped
  for (let f = 1; f <= 6; f++) rows.push(line(id++, "2026-09-30", 0, 70 + f, '"\\N"', String(f), 15)); // street markets: national only
  rows.push(line(id++, "2026-08-01", 0, 20, "3", '"\\N"', 16)); // older than the 7-day window
  const n = new Newest();
  const st = parsePrices(rows.join("\n"), rice, shopMap, n);
  assert.equal(st.offers, 1);
  return n;
}

test("buildRows: newest regular price per shop, 7-day window, offers and outliers out, street markets in the national figure only", () => {
  const n = sample();
  const b = buildRows(n.entries(), n.newestDate);
  assert.equal(b.date, "2026-09-30");
  assert.equal(b.dropped.outliers, 1);
  assert.deepEqual(b.areas, ["Canelones", "Montevideo"]);
  const nat = b.rows.find((r) => r.area === NATIONAL && r.item === "Arroz blanco|Bolsa 1 kg.")!;
  assert.equal(nat.n, 18); // 12 shops + 6 street markets
  assert.equal(nat.min, 60);
  assert.ok(nat.max <= 80);
  const mvd = b.rows.find((r) => r.area === "Montevideo" && r.item === "Arroz blanco|Bolsa 1 kg.")!;
  assert.equal(mvd.n, 7);
  assert.ok(b.rows.every((r) => r.n >= 5), "no figure from fewer than 5 records");
  assert.ok(!b.rows.some((r) => r.area === "(feria)"));
});

test("buildRows: fewer than 5 shops publishes nothing", () => {
  const n = new Newest();
  for (let s = 0; s < 4; s++) n.add(`s${s}`, "Arroz blanco|Bolsa 1 kg.", "Montevideo", "2026-09-30", 70);
  assert.equal(buildRows(n.entries(), "2026-09-30").rows.length, 0);
});

test("matching: English and Spanish, the plain product first", () => {
  const day = { date: "2026-09-30", rows: buildRows(sample().entries(), "2026-09-30").rows };
  const nat = defsFor(day.rows, NATIONAL);
  assert.equal(matchItems(nat, "rice")[0].name, "Arroz blanco");
  assert.equal(matchItems(nat, "arroz")[0].name, "Arroz blanco");
  assert.equal(matchItems(nat, "sugar")[0].name, "Azúcar blanco");
  assert.equal(matchItems(nat, "milk").length, 0);
  assert.equal(norm("Azúcar"), "azucar");
  assert.equal(resolveArea(day.rows, "montevideo"), "Montevideo");
  assert.equal(resolveArea(day.rows, "Atlantida"), null);
});

test("answer: national and department figures, source, licence, posted price, stale notice", () => {
  const day = { date: "2026-09-30", rows: buildRows(sample().entries(), "2026-09-30").rows };
  const a = uyAnswerFromRows(day, { item: "rice", today: "2026-11-11" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "UYU");
  assert.equal(a.sample_size, 18);
  assert.equal(a.price_type, "posted_price");
  assert.match(JSON.stringify(a.source), /Datos Abiertos - Uruguay/);
  assert.match(JSON.stringify(a.source), /Defensa del Consumidor/);
  assert.equal(a.period?.to, "2026-09-30");
  assert.equal(a.period?.from, "2026-09-24");
  assert.equal((a.extra as any).publisher_data_old, undefined, "42 days old is not stale yet");
  const old = uyAnswerFromRows(day, { item: "rice", today: "2026-12-25" });
  assert.equal((old.extra as any).publisher_data_old, true);
  const mvd = uyAnswerFromRows(day, { item: "arroz", region: "Montevideo", today: "2026-11-11" });
  assert.equal(mvd.sample_size, 7);
});

test("answer: bad input teaches the caller", () => {
  const day = { date: "2026-09-30", rows: buildRows(sample().entries(), "2026-09-30").rows };
  assert.throws(() => uyAnswerFromRows(day, { item: "" }), /item is required/);
  assert.throws(() => uyAnswerFromRows(day, { item: "milk" }), /not recognised.*Arroz blanco/);
  assert.throws(() => uyAnswerFromRows(day, { item: "rice", region: "Paris" }), /Departments with figures: Canelones, Montevideo/);
});

test("pickFiles reads the three file links from the catalogue answer", () => {
  const base = "https://catalogodatos.gub.uy/dataset/c2edcd30/resource/x/download/";
  const json = { result: { resources: [{ url: base + "precios_2026.csv" }, { url: base + "productos.csv" }, { url: base + "establecimiento.csv" }, { url: base + "metadatos_precios.csv" }] } };
  const f = pickFiles(json, 2026);
  assert.ok(f.prices.endsWith("precios_2026.csv") && f.products.endsWith("productos.csv") && f.shops.endsWith("establecimiento.csv"));
  assert.throws(() => pickFiles(json, 2027), /lacks/);
  assert.throws(() => pickFiles({}, 2026), /no resources/);
});

test("downloadTail refuses a server that ignores Range (never downloads 1.5 GB)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response("whole file", { status: 200 })) as typeof fetch;
  try { await assert.rejects(() => downloadTail("https://example.test/x.csv"), /ignored the Range/); } finally { globalThis.fetch = orig; }
});

test("downloadTail resumes after a dropped connection", async () => {
  const orig = globalThis.fetch;
  const body = Buffer.from("0123456789");
  let calls = 0;
  globalThis.fetch = (async (_u: any, init: any) => {
    calls++;
    const r = String(init.headers.Range);
    if (calls === 1) {
      assert.equal(r, "bytes=-10");
      let sent = false;
      const rs = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(body.subarray(0, 4)); } else c.error(new Error("reset")); } });
      return new Response(rs, { status: 206, headers: { "content-range": "bytes 100-109/200" } });
    }
    assert.equal(r, "bytes=104-109");
    return new Response(body.subarray(4), { status: 206, headers: { "content-range": "bytes 104-109/200" } });
  }) as typeof fetch;
  try { assert.equal((await downloadTail("https://example.test/x.csv", 10)).toString(), "0123456789"); } finally { globalThis.fetch = orig; }
});

test("harvest: catalogue, small files and a Range tail go in, library rows come out", async () => {
  const orig = globalThis.fetch;
  const base = "https://catalogodatos.gub.uy/x/";
  const tail = Buffer.from(["cut", HEAD, ...(() => { const r: string[] = []; let id = 1; for (let s = 1; s <= 12; s++) { r.push(line(id++, "2026-09-30", 0, 60 + s, String(s), '"\\N"', 15)); r.push(line(id++, "2026-09-24", 0, 61 + s, String(s), '"\\N"', 24)); } return r; })()].join("\n"));
  const toBuf = (s: string) => Buffer.from(s, "latin1");
  const productsCsv = toBuf("id.producto;producto;marca;especificacion;nombre\r\n15;Arroz blanco;Blue Patna;Bolsa 1 kg.;x\r\n24;Azúcar blanco;Bella;Paquete 1 kg.;y\r\n");
  const shopsCsv = toBuf("id.establecimientos;razon.social;nombre.sucursal;direccion;ccz;barrio;cajas;cadena;long;lat;ciudad;depto\r\n" + Array.from({ length: 12 }, (_, i) => `${i + 1};A;B;C;1;D;1;E;0;0;F;Montevideo`).join("\r\n") + "\r\n");
  globalThis.fetch = (async (u: any, init: any) => {
    const url = String(u);
    if (url.includes("package_show")) {
      if (url.includes("-2027")) return new Response("{}", { status: 404 });
      return Response.json({ success: true, result: { resources: [{ url: base + "precios_2026.csv" }, { url: base + "productos.csv" }, { url: base + "establecimiento.csv" }] } });
    }
    if (url.endsWith("productos.csv")) return new Response(productsCsv);
    if (url.endsWith("establecimiento.csv")) return new Response(shopsCsv);
    assert.ok(init?.headers?.Range, "the big file is only ever read with a Range");
    return new Response(tail, { status: 206, headers: { "content-range": `bytes 1000-${999 + tail.length}/1500000000` } });
  }) as typeof fetch;
  try {
    const h = await uyHarvest(new Date("2027-01-10T03:17:00Z"));
    assert.equal(h.date, "2026-09-30");
    assert.equal(h.currency, "UYU");
    assert.ok(h.rows.some((r) => r.area === NATIONAL && r.item === "Arroz blanco|Bolsa 1 kg." && r.n === 12));
    assert.match(h.note!, /offer prices skipped/);
  } finally { globalThis.fetch = orig; }
});

test("manifest: Uruguay groceries, a live example, library-backed", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["UY"]);
  assert.equal(manifest.examples![0].params.item, "rice");
  assert.equal(INFO.price_type, "posted_price");
  assert.equal(typeof uyHistoryKey, "function");
});
