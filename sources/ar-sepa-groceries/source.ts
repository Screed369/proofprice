// Argentina "Precios Claros - Base SEPA" (Subsecretaria de Defensa del Consumidor, Secretaria de Industria y Comercio): the shelf prices that supermarket chains
// must report every day under Resolucion 12/2016. The publisher posts ONE ZIP PER WEEKDAY (about 325 MB) holding one inner ZIP per chain, each with
// comercio.csv, sucursales.csv and productos.csv (pipe separated, about 14 million price rows across about 2,500 shops).
// We never read it per request: the daily collector (harvest) downloads the newest weekday file, keeps for every product (EAN barcode) the list price of
// every shop, and stores one aggregate per province and product (the products priced in the most shops) in the price library.
// POSTED shelf prices (not receipts, not what one shopper paid), in Argentine pesos. Shop names, addresses and coordinates are never read into the library.

import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ar-sepa-groceries",
  country: "Argentina",
  category: "groceries (shop shelf prices of everyday goods)",
  name: "Precios Claros - Base SEPA (Defensa del Consumidor)",
  publisher: "Subsecretaria de Defensa del Consumidor y Lealtad Comercial, Gobierno de la Nacion Argentina, via datos.produccion.gob.ar",
  what_is_recorded:
    "The list (shelf) price of one packaged product, identified by its EAN barcode, in one named supermarket on the day the chain last reported, in Argentine pesos. Chains must report under Resolucion 12/2016.",
  price_type: "posted_price",
  freshness: "Daily files, one per weekday; we read the newest",
  licence: "Creative Commons Atribucion 2.5 Argentina (CC BY 2.5 AR; the dataset page on datos.produccion.gob.ar lists CC BY 4.0)",
  licence_url: "https://www.preciosclaros.gob.ar/terminos_y_condiciones.html",
  attribution:
    "Fuente: Precios Claros - Base SEPA, Gobierno de la Nacion Argentina (Subsecretaria de Defensa del Consumidor), datos.produccion.gob.ar. Licencia CC BY 2.5 AR. Accessed by ProofPrice; changed by ProofPrice: for each product we take every shop's list price and report the median and 10th to 90th percentile across shops, by province. Not endorsed by the Gobierno de la Nacion.",
  homepage: "https://datos.produccion.gob.ar/dataset/sepa-precios",
  limits:
    "Posted list prices that chains report for their shops, not receipts and not what one shopper paid (the government does not vouch for the shops' data); promotions are ignored. " +
    "Packaged products with an EAN barcode only (no loose fruit, vegetables, bread or meat cut by weight). Only the products priced in the most shops are kept, a province needs 5 or more shops for a product, " +
    "and prices more than 4 times above or below a product's national median are dropped as entry errors. Shop names, addresses and coordinates are not stored.",
};

export const PACKAGE_URL = "https://datos.produccion.gob.ar/api/3/action/package_show?id=sepa-precios";
export const KEEP_TOP = 50; // products priced in the most shops
export const KEEP_PER_STAPLE = 2; // plus the best-covered products of each everyday staple, so milk, rice and sugar are not crowded out by soft drinks
export const OUTLIER_FACTOR = 4;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

// ---------- minimal ZIP reader (the publisher's zips are stored or deflated, below 4 GB, no encryption) ----------

export type Reader = (offset: number, length: number) => Buffer;
export interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number }

export function bufferReader(buf: Buffer): Reader {
  return (offset, length) => buf.subarray(offset, offset + length);
}

export function fileReader(fd: number): Reader {
  return (offset, length) => {
    const out = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, out, got, length - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    return got === length ? out : out.subarray(0, got);
  };
}

/** The entries of a ZIP from its central directory. Throws SourceError when the archive is cut short or is ZIP64. */
export function zipEntries(read: Reader, size: number): ZipEntry[] {
  const tailLen = Math.min(size, 65557);
  const tail = read(size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new SourceError("zip file has no central directory (download cut short?)");
  const total = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOffset = tail.readUInt32LE(e + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new SourceError("zip64 archives are not supported");
  if (cdOffset + cdSize > size) throw new SourceError("zip central directory points past the end of the file (download cut short?)");
  const cd = read(cdOffset, cdSize);
  if (total > 0 && (cd.length < 46 || cd.readUInt32LE(0) !== 0x02014b50)) throw new SourceError("zip central directory is damaged (download cut short?)");
  const out: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    out.push({
      name: cd.toString("utf8", p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      csize: cd.readUInt32LE(p + 20),
      usize: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (out.length !== total) throw new SourceError(`zip central directory lists ${total} files but ${out.length} could be read (download cut short?)`);
  return out;
}

/** The uncompressed bytes of one entry. */
export function zipRead(read: Reader, e: ZipEntry): Buffer {
  const lh = read(e.offset, 30);
  if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) throw new SourceError(`zip entry ${e.name} has a bad local header`);
  const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const data = read(start, e.csize);
  if (data.length < e.csize) throw new SourceError(`zip entry ${e.name} is cut short`);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new SourceError(`zip entry ${e.name} uses compression method ${e.method}`);
}

// ---------- text helpers ----------

/** Plain-text normalisation: lower case, no accents, single spaces. */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Decode bytes as UTF-8, falling back to Latin-1 when the bytes are not valid UTF-8. */
export function decodeText(buf: Buffer): string {
  const utf = buf.toString("utf8");
  return utf.includes("�") ? buf.toString("latin1") : utf;
}

/** Provinces by their ISO 3166-2 code as the chains report them in sucursales_provincia. */
export const PROVINCES: Record<string, string> = {
  "AR-A": "Salta", "AR-B": "Buenos Aires", "AR-C": "Ciudad de Buenos Aires", "AR-D": "San Luis", "AR-E": "Entre Rios", "AR-F": "La Rioja", "AR-G": "Santiago del Estero",
  "AR-H": "Chaco", "AR-J": "San Juan", "AR-K": "Catamarca", "AR-L": "La Pampa", "AR-M": "Mendoza", "AR-N": "Misiones", "AR-P": "Formosa", "AR-Q": "Neuquen",
  "AR-R": "Rio Negro", "AR-S": "Santa Fe", "AR-T": "Tucuman", "AR-U": "Chubut", "AR-V": "Tierra del Fuego", "AR-W": "Corrientes", "AR-X": "Cordoba", "AR-Y": "Jujuy", "AR-Z": "Santa Cruz",
};

/** The province name for what a chain wrote ("AR-B", "Buenos Aires", "CABA"), or "" when it is none of the 24. */
export function provinceName(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const byCode = PROVINCES[s.toUpperCase()];
  if (byCode) return byCode;
  const n = norm(s);
  if (n === "caba" || n === "capital federal" || n === "ciudad autonoma de buenos aires") return PROVINCES["AR-C"];
  return Object.values(PROVINCES).find((p) => norm(p) === n) ?? "";
}

/** "00250", "gr" -> "250 g"; "1.00", "LT" -> "1 L"; "1", "UNI" -> "" (a count, not a size). */
export function packLabel(qty: string, unit: string): string {
  const q = Number(qty.trim().replace(",", "."));
  const u = norm(unit).replace(/ /g, "");
  if (!(q > 0) || q > 100000) return "";
  const n = (x: number) => String(Math.round(x * 1000) / 1000);
  if (u === "gr" || u === "g" || u === "grs") return `${n(q)} g`;
  if (u === "kg" || u === "kgs") return `${n(q)} kg`;
  if (u === "lt" || u === "l" || u === "lts") return `${n(q)} L`;
  if (u === "ml") return `${n(q)} ml`;
  if (u === "cc" || u === "cm3") return `${n(q)} ml`;
  return "";
}

/** Product key stored in the library: "LECHE ENTERA SERENISIMA 1L|1 L". Commas become "/" and pipes are removed, so the key is one CSV cell. */
export function itemKey(product: string, pack: string): string {
  const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, "/").replace(/\|/g, " ");
  return `${clean(product)}|${clean(pack) || "1 pack"}`;
}

/** Tidy a shop-typed description: drop the packaging codes some chains append ("PAQ-500-gr", "BRK-1000-ml"), collapse spaces, drop trailing dots and stray prefix dots, cap at 70 characters. */
export function tidyName(raw: string): string {
  return raw.trim().replace(/\b[A-Za-z]{2,4}-\d+(?:\.\d+)?-(?:gr|ml|un|kg|lt|cc)\b\.?/gi, " ").replace(/^[.\s]+/, "").replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 70).trim();
}

/** The pack size written in a product description ("X 1 LT", "x500g", "500 CC", "X 6 U", "docena"), as "1 L", "500 g", "500 ml", "6 units"; "" when none. Chains' own pack fields disagree with each other, the description is what the shopper reads. */
export function packFromName(name: string): string {
  const n = name.replace(/,/g, ".");
  const size = /(?:^|[^a-z0-9])x?\s*(\d+(?:\.\d+)?)\s*-?\s*(kgs?|grs?|g|lts?|l|ml|cc|cm3)(?![a-z])/i;
  const m = size.exec(n);
  if (m) return packLabel(m[1], m[2] === "cm3" ? "cc" : m[2]);
  const d = /\bdocena\b/i.test(n) ? 12 : 0;
  if (d) return `${d} units`;
  const u = /(?:^|[^a-z0-9])x?\s*(\d+)\s*(?:u|un|unid|unidad|unidades)(?![a-z])/i.exec(n);
  return u ? `${u[1]} units` : "";
}

// ---------- reading a store's productos.csv ----------

/** Splits a pipe-separated line (the files do not quote). */
export const splitPipe = (line: string): string[] => line.split("|");

export interface Acc {
  id: number;
  n: number; // shops pricing it
  names: Map<string, number>; // shop-typed description -> number of shops (capped)
  packs: Map<string, number>;
}

/** Keeps one compact record per price (product id, price, province) in typed arrays: about 14 million rows must fit in a few hundred MB. */
export class Collector {
  products = new Map<string, Acc>();
  provinces: string[] = [];
  private provIdx = new Map<string, number>();
  private cap = 1 << 20;
  prodId = new Int32Array(this.cap);
  price = new Float32Array(this.cap);
  prov = new Int8Array(this.cap);
  count = 0;
  rows = 0;
  kept = 0;
  drops = { price: 0, ean: 0, product: 0 };
  newestDate = "";
  stores = 0;
  provIndex(name: string): number {
    if (!name) return -1;
    let i = this.provIdx.get(name);
    if (i === undefined) { i = this.provinces.length; this.provinces.push(name); this.provIdx.set(name, i); }
    return i;
  }
  private grow(): void {
    this.cap *= 2;
    const a = new Int32Array(this.cap); a.set(this.prodId); this.prodId = a;
    const b = new Float32Array(this.cap); b.set(this.price); this.price = b;
    const c = new Int8Array(this.cap); c.set(this.prov); this.prov = c;
  }
  add(barcode: string, price: number, prov: number, name: string, pack: string): void {
    let a = this.products.get(barcode);
    if (!a) { a = { id: this.products.size, n: 0, names: new Map(), packs: new Map() }; this.products.set(barcode, a); }
    if (this.count === this.cap) this.grow();
    this.prodId[this.count] = a.id;
    this.price[this.count] = price;
    this.prov[this.count] = prov;
    this.count++;
    a.n++;
    if (a.names.size < 12 || a.names.has(name)) a.names.set(name, (a.names.get(name) ?? 0) + 1);
    if (pack && (a.packs.size < 8 || a.packs.has(pack))) a.packs.set(pack, (a.packs.get(pack) ?? 0) + 1);
  }
}

const SUC_COLS = ["id_comercio", "id_bandera", "id_sucursal", "sucursales_provincia"] as const;
const PROD_COLS = ["id_comercio", "id_bandera", "id_sucursal", "id_producto", "productos_ean", "productos_descripcion", "productos_cantidad_presentacion", "productos_unidad_medida_presentacion", "productos_precio_lista"] as const;

function header(line: string, cols: readonly string[], what: string): Record<string, number> {
  const head = line.replace(/^﻿/, "").trim().split("|").map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const c of cols) {
    idx[c] = head.indexOf(c);
    if (idx[c] < 0) throw new SourceError(`SEPA ${what} has a new layout: column ${c} is missing (found: ${head.slice(0, 20).join(", ")})`);
  }
  return idx;
}

/** shop key (chain|banner|branch) -> province name, from sucursales.csv. */
export function parseBranches(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split("\n");
  if (!lines.length) return out;
  const idx = header(lines[0], SUC_COLS, "sucursales.csv");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const c = splitPipe(line);
    const prov = provinceName(c[idx.sucursales_provincia] ?? "");
    out.set(`${c[idx.id_comercio]?.trim()}|${c[idx.id_bandera]?.trim()}|${c[idx.id_sucursal]?.trim()}`, prov);
  }
  return out;
}

/** The text encoding of a CSV buffer, from its first megabyte: UTF-8 unless that part is not valid UTF-8. */
export function encodingOf(buf: Buffer): "utf8" | "latin1" {
  return buf.toString("utf8", 0, Math.min(buf.length, 1 << 20)).includes("�") ? "latin1" : "utf8";
}

/** Calls fn for each non-empty line of a buffer, decoding one line at a time (the biggest chain's productos.csv is over 600 MB: never one string). */
export function eachLine(buf: Buffer, fn: (line: string, first: boolean) => void): void {
  const enc = encodingOf(buf);
  let pos = 0, first = true;
  while (pos < buf.length) {
    let end = buf.indexOf(10, pos);
    if (end < 0) end = buf.length;
    let stop = end;
    if (stop > pos && buf[stop - 1] === 13) stop--;
    if (stop > pos) { fn(buf.toString(enc, pos, stop), first); first = false; }
    pos = end + 1;
  }
}

/** Reads one store file's productos.csv into the collector: EAN products with a positive list price. */
export function parseProducts(data: Buffer | string, branches: Map<string, string>, into: Collector): void {
  let idx: Record<string, number> | null = null;
  const onLine = (line: string, first: boolean) => {
    if (first) { idx = header(line, PROD_COLS, "productos.csv"); return; }
    if (!idx || line.length < 10) return;
    into.rows++;
    const c = splitPipe(line);
    if ((c[idx.productos_ean] ?? "").trim() !== "1") { into.drops.ean++; return; }
    const code = (c[idx.id_producto] ?? "").trim();
    if (!/^\d{8,14}$/.test(code)) { into.drops.ean++; return; }
    const price = Number((c[idx.productos_precio_lista] ?? "").trim().replace(",", "."));
    if (!(price > 0) || price > 1e8) { into.drops.price++; return; }
    const name = tidyName(c[idx.productos_descripcion] ?? "");
    if (!name) { into.drops.product++; return; }
    const shop = `${c[idx.id_comercio]?.trim()}|${c[idx.id_bandera]?.trim()}|${c[idx.id_sucursal]?.trim()}`;
    // (49 repeated shop+product rows in 14 million on 29 Oct 2026: not worth a 4-million-entry set)
    const pack = packLabel(c[idx.productos_cantidad_presentacion] ?? "", c[idx.productos_unidad_medida_presentacion] ?? "");
    into.add(code, price, into.provIndex(branches.get(shop) ?? ""), name, pack);
    into.kept++;
  };
  if (typeof data === "string") { let first = true; for (const l of data.split("\n")) { const t = l.replace(/\r$/, ""); if (t) { onLine(t, first); first = false; } } }
  else eachLine(data, onLine);
}

/** One chain's inner zip: its sucursales.csv gives provinces, its productos.csv gives prices. */
export function readStoreZip(zip: Buffer, into: Collector): void {
  const read = bufferReader(zip);
  const entries = zipEntries(read, zip.length);
  const find = (file: string) => entries.find((e) => e.name.split("/").pop()!.toLowerCase() === file);
  const prod = find("productos.csv");
  if (!prod) throw new SourceError(`store zip has no productos.csv (has: ${entries.map((e) => e.name).join(", ")})`);
  const suc = find("sucursales.csv");
  const branches = suc ? parseBranches(decodeText(zipRead(read, suc))) : new Map<string, string>();
  parseProducts(zipRead(read, prod), branches, into);
  into.stores++;
}

// ---------- choosing and aggregating ----------

/** Words that mark an everyday staple; the best-covered products of each are kept even when soft drinks and snacks are priced in more shops. */
export const STAPLES = ["leche", "azucar", "arroz", "aceite", "harina", "fideos", "yerba", "cafe", "te", "manteca", "queso", "yogur", "atun", "galletitas", "polenta", "lentejas", "mayonesa", "salsa", "papel higienico", "detergente", "jabon", "shampoo", "cerveza", "vino", "agua", "gaseosa", "huevos", "pan", "sal", "avena", "cacao", "dulce de leche", "mermelada", "puré", "pure de tomate", "arvejas", "garbanzos", "pañales", "lavandina"];

/** The most representative shop description of a product: the longest of those typed in at least a tenth of the shops (shops abbreviate; the longest is the most readable). */
export function bestName(names: Map<string, number>): string {
  const total = [...names.values()].reduce((a, b) => a + b, 0);
  const common = [...names].filter(([, k]) => k >= Math.max(2, total / 10));
  const pool = common.length ? common : [...names];
  return pool.sort((a, b) => b[0].length - a[0].length || b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function bestPack(packs: Map<string, number>): string {
  return [...packs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

const median = (sorted: number[]) => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

export interface Built { rows: DailyRow[]; date: string | null; items: number; provinces: string[]; dropped: { outliers: number } }

/** Library rows for the day: area = province (or ALL), item = "<product>|<pack>"; n = shops. */
export function buildRows(c: Collector, date: string, keepTop = KEEP_TOP, perStaple = KEEP_PER_STAPLE): Built {
  const cands = [...c.products].filter(([, a]) => a.n >= MIN_PUBLISH).map(([code, a]) => ({ code, a, n: a.n, name: bestName(a.names) }));
  cands.sort((x, y) => y.n - x.n || x.code.localeCompare(y.code));
  const chosen = new Map<string, (typeof cands)[number]>();
  for (const x of cands.slice(0, keepTop)) chosen.set(x.code, x);
  for (const w of STAPLES) {
    const re = new RegExp(`(^| )${norm(w)}( |$)`);
    let k = 0;
    for (const x of cands) {
      if (k >= perStaple) break;
      if (re.test(norm(x.name))) { chosen.set(x.code, x); k++; }
    }
  }
  // one pass over the stored rows: collect the prices of the chosen products only
  const byId = new Map<number, { item: string; prices: number[]; prov: number[] }>();
  const used = new Set<string>();
  for (const x of chosen.values()) {
    const pack = packFromName(x.name) || bestPack(x.a.packs);
    let item = itemKey(x.name, pack);
    if (used.has(item)) item = itemKey(`${x.name} (${x.code.slice(-4)})`, pack); // two barcodes with the same text stay apart
    used.add(item);
    byId.set(x.a.id, { item, prices: [], prov: [] });
  }
  for (let i = 0; i < c.count; i++) {
    const g = byId.get(c.prodId[i]);
    if (g) { g.prices.push(Math.round(c.price[i] * 100) / 100); g.prov.push(c.prov[i]); }
  }
  let outliers = 0;
  const recs: { area: string; item: string; price: number }[] = [];
  for (const g of byId.values()) {
    const med = median([...g.prices].sort((p, q) => p - q));
    for (let i = 0; i < g.prices.length; i++) {
      const price = g.prices[i];
      if (price > med * OUTLIER_FACTOR || price < med / OUTLIER_FACTOR) { outliers++; continue; }
      recs.push({ area: g.prov[i] >= 0 ? c.provinces[g.prov[i]] : "", item: g.item, price });
    }
  }
  // provinces: only records whose shop has a known province; national: every record
  const rows = aggregateDaily(recs.filter((r) => r.area), false).filter((r) => r.n >= MIN_PUBLISH);
  const national = aggregateDaily(recs.map((r) => ({ ...r, area: NATIONAL })), false).filter((r) => r.n >= MIN_PUBLISH);
  const all = [...rows, ...national].sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  const provinces = [...new Set(all.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  return { rows: all, date: c.newestDate || date, items: new Set(all.map((r) => r.item)).size, provinces, dropped: { outliers } };
}

// ---------- downloading ----------

export interface Weekday { url: string; name: string; modified: string }

/** The weekday ZIP resources of the SEPA retail dataset (CKAN package_show JSON). */
export function parsePackage(json: unknown): { name: string; url: string }[] {
  const res = (json as { result?: { resources?: { name?: string; url?: string; format?: string }[] } })?.result?.resources;
  if (!Array.isArray(res)) throw new SourceError("SEPA catalogue has no resources (layout changed?)");
  const out = res.filter((r) => r.url && /sepa_[a-z]+\.zip$/i.test(r.url)).map((r) => ({ name: String(r.name ?? ""), url: String(r.url) }));
  if (!out.length) throw new SourceError("SEPA catalogue lists no sepa_<day>.zip files (layout changed?)");
  return out;
}

const STEP_MS = { head: 30_000, download: 270_000 };

/** The Last-Modified header of a weekday file: a HEAD request, else a GET whose body is thrown away (headers are enough; never pull 325 MB for them). */
async function lastModified(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(STEP_MS.head) });
    if (res.ok) return res.headers.get("last-modified") ?? "";
  } catch { /* fall through to GET */ }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), STEP_MS.head);
  try {
    const res = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!res.ok) throw new SourceError(`SEPA file returned HTTP ${res.status}`);
    const lm = res.headers.get("last-modified") ?? "";
    void res.body?.cancel().catch(() => undefined);
    return lm;
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

/** Download a file to disk, checking the byte count against Content-Length; the server ignores Range, so a cut-short download starts again.
 *  Every try has its own deadline, so a stalled transfer fails with a message that says how far it got (the collector's own timeout says nothing). */
export async function downloadTo(url: string, file: string, tries = 2): Promise<number> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const t0 = Date.now();
    let have = 0;
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(STEP_MS.download) });
      if (!res.ok) throw new SourceError(`SEPA file returned HTTP ${res.status}`);
      const want = Number(res.headers.get("content-length") || 0);
      const chunks: Buffer[] = [];
      const reader = res.body!.getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(Buffer.from(r.value));
        have += r.value.length;
      }
      if (want && have < want) { last = `try ${i + 1}: got ${have} of ${want} bytes in ${Math.round((Date.now() - t0) / 1000)}s`; continue; }
      writeFileSync(file, Buffer.concat(chunks, have));
      return have;
    } catch (e) {
      if (e instanceof SourceError && /HTTP 4\d\d/.test(e.message)) throw e;
      last = `try ${i + 1}: ${(e as Error).message.slice(0, 120)} after ${have} bytes in ${Math.round((Date.now() - t0) / 1000)}s`;
    }
  }
  throw new SourceError(`SEPA file download failed (${last})`);
}

/** Read a downloaded weekday zip: every chain's zip goes through the collector. Returns the date of the snapshot (the folder name inside the zip). */
export function readWeekdayZip(file: string, into: Collector): { date: string; zips: number; failed: string[] } {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    const read = fileReader(fd);
    const entries = zipEntries(read, size);
    let date = "";
    let zips = 0;
    const failed: string[] = [];
    for (const e of entries) {
      const d = /^(\d{4}-\d{2}-\d{2})\//.exec(e.name);
      if (d && d[1] > date) date = d[1];
      if (!/\.zip$/i.test(e.name) || e.usize === 0) continue;
      try {
        readStoreZip(zipRead(read, e), into);
        zips++;
      } catch (err) {
        failed.push(`${e.name.split("/").pop()}: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    if (date > into.newestDate) into.newestDate = date;
    return { date, zips, failed };
  } finally {
    closeSync(fd);
  }
}

export async function sepaHarvest(): Promise<HarvestResult> {
  const catRes = await fetch(PACKAGE_URL, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!catRes.ok) throw new SourceError(`SEPA catalogue returned HTTP ${catRes.status}`);
  const days = parsePackage(await catRes.json());
  const settled = await Promise.allSettled(days.map(async (d) => ({ ...d, modified: await lastModified(d.url) } as Weekday)));
  const dated: Weekday[] = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!dated.length) throw new SourceError(`None of the SEPA weekday files answered (${settled.map((r) => (r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason).slice(0, 60) : "ok")).slice(0, 3).join("; ")})`);
  dated.sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0));
  const dir = mkdtempSync(join(tmpdir(), "sepa-"));
  try {
    const file = join(dir, "day.zip");
    const bytes = await downloadTo(dated[0].url, file);
    const c = new Collector();
    const r = readWeekdayZip(file, c);
    if (!c.kept) throw new SourceError(`SEPA file held no usable prices (${c.rows} rows read, dropped ${JSON.stringify(c.drops)}; failed ${r.failed.slice(0, 3).join("; ")})`);
    if (r.failed.length > Math.max(2, r.zips / 4)) throw new SourceError(`SEPA: ${r.failed.length} chain files failed (${r.failed.slice(0, 3).join("; ")})`);
    const iso = r.date || new Date(Date.parse(dated[0].modified) || Date.now()).toISOString().slice(0, 10);
    const built = buildRows(c, iso);
    if (!built.rows.length || !built.date) throw new SourceError(`SEPA files held no product priced in ${MIN_PUBLISH} or more shops (${c.rows} rows read)`);
    return {
      date: built.date,
      currency: "ARS",
      unit: "per pack named in the item",
      rows: built.rows,
      note: `${dated[0].name} file (${Math.round(bytes / 1e6)} MB, snapshot ${built.date}): ${r.zips} chain files, ${c.stores} read, ${c.rows} rows, ${c.kept} EAN prices kept; ${built.items} products, ${built.provinces.length} provinces; ${built.dropped.outliers} outlier prices dropped${r.failed.length ? `; ${r.failed.length} chain files failed` : ""}.`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- matching (Spanish names; English words through a small gloss) ----------
export const GLOSS: Record<string, string> = {
  leche: "milk", huevo: "egg eggs", huevos: "egg eggs", pollo: "chicken", arroz: "rice", azucar: "sugar", aceite: "oil", pan: "bread", atun: "tuna", jabon: "soap",
  papel: "paper", higienico: "toilet", detergente: "detergent", cafe: "coffee", harina: "flour", sal: "salt", fideos: "pasta noodles spaghetti", tallarines: "pasta noodles",
  galletitas: "cookies biscuits crackers", gaseosa: "soda soft drink", agua: "water", cerveza: "beer", vino: "wine", jamon: "ham", queso: "cheese", manteca: "butter",
  crema: "cream", yogur: "yogurt yoghurt", yogurt: "yogurt yoghurt", tomate: "tomato", mayonesa: "mayonnaise", mostaza: "mustard", ketchup: "ketchup", chocolate: "chocolate",
  mermelada: "jam", lentejas: "lentils", garbanzos: "chickpeas", arvejas: "peas", vinagre: "vinegar", yerba: "mate yerba", mate: "mate yerba", te: "tea", cacao: "cocoa",
  avena: "oats oatmeal", polenta: "polenta cornmeal", shampoo: "shampoo", dental: "toothpaste", panales: "diaper nappy", lavandina: "bleach", suavizante: "softener fabric",
  jugo: "juice", entera: "whole full fat", descremada: "skimmed skim", deslactosada: "lactose free", chocolatada: "chocolate milk", girasol: "sunflower", oliva: "olive",
  integral: "wholegrain", dulce: "sweet", salsa: "sauce", pure: "puree", cereal: "cereal", cereales: "cereal", lata: "tin can", gas: "sparkling", sin: "without",
};
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "cooking", "table", "plain", "in", "argentina", "how", "much", "is", "for", "retail", "de", "del", "la", "el", "un", "una", "precio", "precios", "x"]);
const QUERY_SYNONYMS: Record<string, string> = { eggs: "egg", huevos: "huevo", noodles: "pasta", spaghetti: "pasta" };

/** Specialty variants that must not win a plain question ("milk" is fresh or UHT milk, not chocolate milk or dulce de leche). */
const SPECIALTY: Record<string, string[]> = {
  fermentada: ["fermentada", "fermented", "actimel"], yogur: ["yogur", "yogurt", "yoghurt"], saborizada: ["saborizada", "flavoured", "flavored"], chocolatada: ["chocolatada", "chocolate"], dulce: ["dulce", "sweet"], polvo: ["polvo", "powder", "powdered"], condensada: ["condensada", "condensed"], vegetal: ["vegetal", "vegetable"],
  almendras: ["almendras", "almond"], coco: ["coco", "coconut"],
};

export interface Def { key: string; name: string; pack: string; n: number; row: DailyRow }

export function parseKey(key: string): { name: string; pack: string } | null {
  const p = key.split("|");
  return p.length === 2 ? { name: p[0], pack: p[1] } : null;
}

function wordsOf(name: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(name).split(" ").filter(Boolean)) {
    out.add(stem(w));
    const g = GLOSS[w] ?? GLOSS[stem(w)];
    if (g) for (const e of g.split(" ")) out.add(stem(e));
  }
  return out;
}

/** Products matching a question in English or Spanish, best first: every query word must be a word of the name or its English gloss; shorter names (more generic) rank higher. */
export function matchItems(defs: Def[], query: string): Def[] {
  const words = norm(query).split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(QUERY_SYNONYMS[w] ?? w));
  if (!words.length) return [];
  const scored: { d: Def; s: number }[] = [];
  for (const d of defs) {
    const own = norm(d.name).split(" ").filter(Boolean);
    const has = wordsOf(d.name);
    if (!words.every((w) => has.has(w))) continue;
    const asked = new Set(words);
    const specialty = own.some((w) => SPECIALTY[stem(w)] && !SPECIALTY[stem(w)].some((x) => asked.has(stem(x))));
    const lead = own.length > 0 && words.some((w) => stem(own[0]) === w || (wordsOf(own[0]).has(w))); // the product noun comes first: "LECHE UAT ..." is milk, "BEBIDA ... LECHE" is not
    scored.push({ d, s: 100 - 2 * Math.max(0, own.length - words.length) - (specialty ? 25 : 0) + (lead ? 30 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s || b.d.n - a.d.n || a.d.key.localeCompare(b.d.key)).map((x) => x.d);
}

export function defsFor(rows: DailyRow[], area: string): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== area || r.n < MIN_PUBLISH) continue;
    const k = parseKey(r.item);
    if (k) out.push({ key: r.item, ...k, n: r.n, row: r });
  }
  return out;
}

const PROVINCE_ALIASES: Record<string, string> = {
  caba: "ciudad de buenos aires", "capital federal": "ciudad de buenos aires", "buenos aires city": "ciudad de buenos aires", "ciudad autonoma de buenos aires": "ciudad de buenos aires",
  "buenos aires province": "buenos aires", pba: "buenos aires", cordoba: "cordoba", "rio negro": "rio negro", "tierra del fuego": "tierra del fuego", tucuman: "tucuman", neuquen: "neuquen",
};

/** The library's province name for what the caller typed, or null. */
export function resolveProvince(rows: DailyRow[], region: string): string | null {
  const provinces = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q0 = norm(region);
  const q = PROVINCE_ALIASES[q0] ?? q0;
  if (!q) return null;
  return provinces.find((s) => norm(s) === q) ?? provinces.find((s) => norm(s).includes(q) && q !== "buenos aires") ?? null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across shops, of the list price of the product (one EAN barcode) in the newest daily file of Precios Claros - Base SEPA, in Argentine pesos. " +
    "Posted shelf prices that chains report under Resolucion 12/2016, not receipts; promotions are ignored; n is the number of shops (5 or more needed)."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function sepaAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday packaged product in plain words such as 'milk', 'sugar', 'rice', 'yerba mate', 'cooking oil', 'pasta' or 'leche'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let place = "Argentina";
  if (region) {
    const st = resolveProvince(day.rows, region);
    if (!st) {
      const provinces = [...new Set(day.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (no product priced in 5 or more shops there, or not an Argentine province). Provinces with figures: ${provinces.join(", ")}. Leave region out for the national figure.`);
    }
    area = st;
    place = st;
  }
  const period = { from: day.date, to: day.date };
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country: "AR", item, ...(region ? { region } : {}) }, summary: null, currency: "ARS", unit: "per pack",
      period, method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  const hits = matchItems(defsFor(day.rows, area), item);
  if (!hits.length) {
    const all = matchItems(defsFor(day.rows, NATIONAL), item);
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.name))].sort().slice(0, 30);
    return empty(
      area !== NATIONAL && all.length
        ? `Fewer than 5 shops in ${place} priced '${item}' in the newest file. Leave region out for the national figure.`
        : `No product matching '${item}' is priced in 5 or more shops in our copy. Products held include: ${names.join("; ")}.`,
    );
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(day.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > 14;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${d.pack}`);
  return buildAnswer({
    source: INFO,
    query: { country: "AR", item: `${best.name}, ${best.pack}`, ...(region ? { region: place } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "ARS",
    unit: `per ${best.pack}`,
    period,
    method: methodText(),
    describe: (x) =>
      `Precios Claros (SEPA) shelf prices in ${place} put ${best.name} (${best.pack}) at a median of ${fmtMoney(x.median, "ARS")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "ARS")}–${fmtMoney(x.high, "ARS")} across shops. ` +
      `These are posted list prices reported by the chains, not receipts; the file is from ${day.date}.` +
      (stale ? ` The newest data is ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      shops: r.n,
      area: place,
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { publisher_data_old: true, days_since_newest: ageDays } : {}),
    },
  });
}

export async function sepaPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Precios Claros (SEPA) files daily; data appears after the next collection.");
  return sepaAnswerFromRows(day, input);
}

export function sepaHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveProvince(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name}, ${area === NATIONAL ? "Argentina" : area}` } : null;
  } catch {
    return null;
  }
}
