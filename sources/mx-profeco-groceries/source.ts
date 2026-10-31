// Mexico "Quien es Quien en los Precios" (Profeco, the federal consumer protection agency): shelf prices of everyday goods that Profeco inspectors
// record in named shops. One row per shop, product, pack and day. The yearly file is a 60 MB RAR holding monthly CSVs, so we never read it per request:
// the daily collector (harvest) downloads the newest yearly RAR, unpacks it with 7-Zip, reads only the newest monthly CSV(s), keeps each shop's newest
// price per product and pack over the last 30 days, and stores one aggregate per state and product (the best-covered ones) in the price library.
// POSTED shelf prices (not receipts, not what one shopper paid), in Mexican pesos. Addresses, shop names and coordinates are never read into the library.

import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "mx-profeco-groceries",
  country: "Mexico",
  category: "groceries (shop shelf prices of everyday goods)",
  name: "Quien es Quien en los Precios (Profeco)",
  publisher: "Procuraduria Federal del Consumidor (Profeco), via datos.profeco.gob.mx and datos.gob.mx",
  what_is_recorded:
    "The shelf price of one everyday product and pack size (food, drinks, personal care, household goods, medicines, appliances) in one named shop on one day, recorded by Profeco inspectors, in Mexican pesos.",
  price_type: "posted_price",
  freshness: "Monthly, about 7 weeks behind",
  licence: "Libre Uso MX (open data terms of datos.gob.mx: free to copy and reuse, also commercially, with attribution)",
  licence_url: "https://datos.gob.mx/libreusomx",
  attribution:
    "Source: Procuraduria Federal del Consumidor (Profeco), programa Quien es Quien en los Precios, datos.profeco.gob.mx, Libre Uso MX. Accessed by ProofPrice; changed by ProofPrice: for each product and pack we take every shop's newest price over 30 days and report the median and 10th to 90th percentile across shops, by state. Not endorsed by Profeco.",
  homepage: "https://datos.profeco.gob.mx/",
  limits:
    "Posted shelf prices that Profeco inspectors recorded in named shops, not receipts and not what one shopper paid; the sample is not representative of all shops. " +
    "Brands are pooled within a product and pack. Only the products and packs priced in the most shops are kept, a state needs 5 or more shops for a product, " +
    "and prices more than 4 times above or below the product's national median are dropped as entry errors. Shop names, addresses and coordinates are not stored.",
};

// The publisher moved the catalogue on 27 Oct 2026: yearly files are now static links docs/qqp/QQP_<year>.rar on the root page.
export const INDEX_URL = "https://datos.profeco.gob.mx/";
export const FILE_BASE = "https://datos.profeco.gob.mx/";
export const WINDOW_DAYS = 30; // a shop counts when its newest price for the product is within this many days of the newest day
export const KEEP_ITEMS = 120; // products (product + pack) kept in the library: the ones priced in the most shops
export const OUTLIER_FACTOR = 4;
export const STALE_AFTER_DAYS = 7;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** One CSV line into cells ("" inside quotes is a quote). */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cell = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

/** Plain-text normalisation: lower case, no accents, single spaces. */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Decode bytes as UTF-8, falling back to Latin-1 when the bytes are not valid UTF-8 (the files have changed encoding before). */
export function decodeText(buf: Buffer): string {
  const utf = buf.toString("utf8");
  return utf.includes("�") ? buf.toString("latin1") : utf;
}

/** "2026-08-14", "14/08/2026" or "2026-08-14 10:30:00" to "2026-08-14", or "" when it is neither. */
export function isoDate(raw: string): string {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** Product key stored in the library: "LECHE ULTRAPASTEURIZADA|1 L". Commas become "/" and pipes are removed, so the key is one CSV cell. */
export function itemKey(product: string, pack: string): string {
  const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, "/").replace(/\|/g, " ");
  return `${clean(product)}|${clean(pack)}`;
}

/** Title-case a state name from the file ("CIUDAD DE MEXICO" -> "Ciudad De Mexico"); accents are kept. */
export function stateName(raw: string): string {
  return raw.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

const COLUMNS = ["producto", "presentacion", "precio", "fecha_registro", "estado", "cadena_comercial"] as const;

export interface Layout { idx: Record<string, number>; body: string }

export function readHeader(text: string): Layout {
  const nl = text.indexOf("\n");
  if (nl < 0) throw new SourceError("Profeco price file is empty");
  const head = splitLine(text.slice(0, nl).replace(/^﻿/, "").trim()).map((h) => norm(h).replace(/ /g, "_"));
  const idx: Record<string, number> = {};
  for (const k of [...COLUMNS, "direccion", "nombre_comercial", "municipio", "marca", "categoria"]) idx[k] = head.indexOf(k);
  for (const k of COLUMNS) if (idx[k] < 0) throw new SourceError(`Profeco price file has a new layout: column ${k} is missing (found: ${head.join(", ")})`);
  return { idx, body: text.slice(nl + 1) };
}

export interface Seen { date: string; price: number; item: string; state: string }

/** Keeps, for every shop and item, the newest price. A shop is its chain + trade name + municipality + address, turned into a number-free key that lives only in memory. */
export class Newest {
  private map = new Map<string, Seen>();
  newestDate = "";
  rows = 0;
  kept = 0;
  add(shop: string, item: string, state: string, date: string, price: number): void {
    this.kept++;
    if (date > this.newestDate) this.newestDate = date;
    const k = `${shop}\u0000${item}`;
    const cur = this.map.get(k);
    if (!cur || date > cur.date) this.map.set(k, { date, price, item, state });
  }
  get size(): number { return this.map.size; }
  entries(): Seen[] { return [...this.map.values()]; }
}

export function parsePrices(text: string, into: Newest): { rows: number; kept: number } {
  const { idx, body } = readHeader(text);
  let rows = 0, kept = 0;
  let pos = 0;
  while (pos < body.length) {
    let end = body.indexOf("\n", pos);
    if (end < 0) end = body.length;
    const line = body.slice(pos, end).replace(/\r$/, "");
    pos = end + 1;
    if (!line) continue;
    rows++;
    const c = splitLine(line);
    const price = Number((c[idx.precio] ?? "").replace(",", "."));
    const date = isoDate(c[idx.fecha_registro] ?? "");
    const product = (c[idx.producto] ?? "").trim(), pack = (c[idx.presentacion] ?? "").trim();
    const state = stateName(c[idx.estado] ?? "");
    if (!(price > 0) || !date || !product || !state) continue;
    const shop = [c[idx.cadena_comercial], idx.nombre_comercial >= 0 ? c[idx.nombre_comercial] : "", idx.municipio >= 0 ? c[idx.municipio] : "", idx.direccion >= 0 ? c[idx.direccion] : ""]
      .map((x) => (x ?? "").trim().toLowerCase()).join("~");
    into.add(shop, itemKey(product, pack), state, date, price);
    kept++;
  }
  return { rows, kept };
}

export interface Built { rows: DailyRow[]; date: string | null; items: number; states: string[]; dropped: { outliers: number } }

/** Library rows for the newest day: area = state (or ALL), item = "<product>|<pack>"; n = shops. Keeps the KEEP_ITEMS products priced in the most shops. */
export function buildRows(entries: Seen[], newestDate: string, keepItems = KEEP_ITEMS): Built {
  if (!newestDate) return { rows: [], date: null, items: 0, states: [], dropped: { outliers: 0 } };
  const cutoff = dayNumber(newestDate) - (WINDOW_DAYS - 1);
  const recent = entries.filter((e) => dayNumber(e.date) >= cutoff);
  const perItem = new Map<string, number[]>();
  for (const e of recent) {
    const a = perItem.get(e.item);
    if (a) a.push(e.price); else perItem.set(e.item, [e.price]);
  }
  const top = [...perItem].filter(([, p]) => p.length >= MIN_PUBLISH).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, keepItems);
  const medians = new Map<string, number>();
  for (const [key, prices] of top) {
    const s = [...prices].sort((a, b) => a - b);
    medians.set(key, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  let outliers = 0;
  const recs: { area: string; item: string; price: number }[] = [];
  for (const e of recent) {
    const med = medians.get(e.item);
    if (med === undefined) continue;
    if (e.price > med * OUTLIER_FACTOR || e.price < med / OUTLIER_FACTOR) { outliers++; continue; }
    recs.push({ area: e.state, item: e.item, price: e.price });
  }
  const rows = aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH);
  const states = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  return { rows, date: newestDate, items: new Set(rows.map((r) => r.item)).size, states, dropped: { outliers } };
}

/** The yearly RAR links on the index page, newest year first: [{ year, url }]. Hashes change when a file is replaced, so they are read every run. */
export function parseIndex(html: string): { year: number; url: string }[] {
  const out: { year: number; url: string }[] = [];
  const re = /<a[^>]+href=["']([^"']*file\.php\?t=[0-9a-f]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<[^>]*>/g, " ");
    const y = /\b(20\d{2})\b/.exec(text);
    if (!y) continue; // Metadatos / Diccionario links carry no year
    const href = m[1];
    out.push({ year: Number(y[1]), url: href.startsWith("http") ? href : new URL(href, FILE_BASE).toString() });
  }
  // Catalogue layout since 27 Oct 2026: <a href="docs/qqp/QQP_2026.rar">
  const re2 = /href=["']([^"']*\/QQP_(20\d{2})\.rar)["']/gi;
  while ((m = re2.exec(html))) {
    const href = m[1];
    out.push({ year: Number(m[2]), url: href.startsWith("http") ? href : new URL(href, FILE_BASE).toString() });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** Unpack a RAR with whichever extractor the machine has (GitHub's ubuntu runners ship 7z). */
export function unpack(file: string, dir: string): void {
  const tools: [string, string[]][] = [["7z", ["x", "-y", `-o${dir}`, file]], ["7zz", ["x", "-y", `-o${dir}`, file]], ["7za", ["x", "-y", `-o${dir}`, file]], ["unrar", ["x", "-y", file, dir + "/"]], ["bsdtar", ["-xf", file, "-C", dir]]];
  const errors: string[] = [];
  for (const [bin, args] of tools) {
    try {
      execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
      return;
    } catch (e) {
      const err = e as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // tool not installed: not worth a word in the error
      const out = String(err.stderr || "").trim() || String(err.stdout || "").trim().split("\n").slice(-3).join(" ");
      errors.push(`${bin}: ${out.replace(/\s+/g, " ").slice(0, 160)}`);
      // The publisher's 2026 archive was uploaded cut short (26 Oct 2026: 20.7 MB announced and served, ~60 MB expected). 7-Zip still unpacks the months before the cut,
      // so keep them: the answer's period shows the newest day actually read, never a later one.
      if (hasPartialCsv(dir)) return;
    }
  }
  // Last resort: the runner's p7zip (16.02) cannot read RAR5, so fetch the official unrar library compiled to WebAssembly (pure JS, no system tool).
  try { unpackWithNodeUnrar(file, dir); return; } catch (e) { errors.push(`node-unrar-js: ${(e as Error).message.replace(/\s+/g, " ").slice(0, 160)}`); }
  throw new SourceError(`Could not unpack the Profeco RAR (${errors.join("; ")})`);
}

/** True when an extractor that reported an error still left monthly CSV files behind (a truncated archive). */
export function hasPartialCsv(dir: string): boolean {
  try { return listCsv(dir).length > 0; } catch { return false; }
}

/** Unpack with node-unrar-js, installed on the fly into a scratch folder (nothing is added to package.json). */
export function unpackWithNodeUnrar(file: string, dir: string): void {
  const lib = mkdtempSync(join(tmpdir(), "unrarjs-"));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", lib, "node-unrar-js@2.0.2"], { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  const script = `const {createExtractorFromFile}=require(${JSON.stringify(join(lib, "node_modules", "node-unrar-js"))});` +
    `(async()=>{const ex=await createExtractorFromFile({filepath:${JSON.stringify(file)},targetPath:${JSON.stringify(dir)}});` +
    `const {files}=ex.extract();let n=0;for(const f of files){n++;}console.log(n);})().catch(e=>{console.error(String(e&&e.message||e));process.exit(1);});`;
  try {
    execFileSync(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  } catch (e) {
    const err = e as Error & { stderr?: Buffer | string };
    throw new Error(String(err.stderr || err.message).trim());
  }
}

/** What a downloaded yearly file really is, from its first bytes (the publisher changed the catalogue on 27 Oct 2026 and the file no longer opened). */
export function sniff(buf: Buffer): "rar" | "zip" | "7z" | "gzip" | "csv" | "html" | "unknown" {
  const h = buf.subarray(0, 8);
  if (h.subarray(0, 4).toString("latin1") === "Rar!") return "rar";
  if (h[0] === 0x50 && h[1] === 0x4b) return "zip";
  if (h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf) return "7z";
  if (h[0] === 0x1f && h[1] === 0x8b) return "gzip";
  const head = buf.subarray(0, 400).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml")) return "html";
  if (/^"?producto"?\s*[,;|\t]/.test(head)) return "csv";
  return "unknown";
}

/** A short description of a download for error messages: size and first bytes. */
export function describeBytes(buf: Buffer): string {
  const head = buf.subarray(0, 24);
  const printable = head.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
  return `${buf.length} bytes, type ${sniff(buf)}, starts ${head.toString("hex")} "${printable}"`;
}

/** Put a downloaded yearly file into `out`: unpack archives, gunzip, or store a plain CSV as it is. */
export function extractYearly(buf: Buffer, dir: string, out: string, year: number): void {
  const kind = sniff(buf);
  mkdirSync(out, { recursive: true });
  if (kind === "csv") { writeFileSync(join(out, `${year}.csv`), buf); return; }
  if (kind === "gzip") { extractYearly(gunzipSync(buf), dir, out, year); return; }
  if (kind === "html" || kind === "unknown") throw new SourceError(`Profeco ${year} file is not an archive (${describeBytes(buf)})`);
  const file = join(dir, `qqp-${year}.${kind}`);
  writeFileSync(file, buf);
  try { unpack(file, out); } catch (e) { throw new SourceError(`Profeco ${year} file: ${describeBytes(buf)}. ${(e as Error).message.replace("Could not unpack the Profeco RAR", "Unpack failed")}`); }
}

/** All CSV files under dir, sorted by path (monthly file names start with the month). */
export function listCsv(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listCsv(p));
    else if (/\.csv$/i.test(name)) out.push(p);
  }
  return out.sort();
}

/** Download a file completely: the server closed the 2026 archive after 20.7 MB of ~60 MB (30 Oct 2026), so compare with Content-Length and resume with Range requests. */
export async function downloadFully(url: string, year: number, tries = 10): Promise<Buffer> {
  let parts: Buffer[] = [];
  let have = 0, total = 0;
  for (let i = 0; i < tries; i++) {
    let round = 0;
    try {
      const res = await fetch(url, { headers: have ? { ...UA, Range: `bytes=${have}-` } : UA });
      if (res.status === 416 && have) break; // nothing left after what we hold: the file is complete
      if (!res.ok && res.status !== 206) throw new SourceError(`Profeco file ${year} returned HTTP ${res.status}`);
      if (have && res.status !== 206) { parts = []; have = 0; total = 0; } // server ignored Range: start again
      const range = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
      if (range) total = Number(range[1]);
      else if (!total && res.status === 200) total = Number(res.headers.get("content-length") || 0);
      const reader = res.body!.getReader();
      for (;;) { // keep what arrived even if the connection drops half way
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { break; }
        if (chunk.done) break;
        parts.push(Buffer.from(chunk.value)); have += chunk.value.length; round += chunk.value.length;
      }
    } catch (e) { if (e instanceof SourceError) throw e; }
    if (total && have >= total) break;
    // no length announced (chunked): ask again from where we stopped; an empty answer or a 416 means the file is complete
    if (!total && have > 0 && round === 0) break;
  }
  if (total && have < total) throw new SourceError(`Profeco file ${year} incomplete after ${tries} tries: ${have} of ${total} bytes`);
  return Buffer.concat(parts);
}

/** For error messages only: the column names and the product, price, date and state of the first row (no shop names or addresses). */
export function describeFirstRow(buf: Buffer): string {
  try {
    const text = decodeText(buf);
    const { idx, body } = readHeader(text);
    const c = splitLine(body.slice(0, Math.max(0, body.indexOf("\n"))).replace(/\r$/, ""));
    const pick = (k: string) => JSON.stringify((c[idx[k]] ?? "").slice(0, 40));
    return `header ${text.slice(0, text.indexOf("\n")).slice(0, 200)}; first row producto=${pick("producto")} precio=${pick("precio")} fecha=${pick("fecha_registro")} estado=${pick("estado")}`;
  } catch (e) { return `unreadable (${(e as Error).message.slice(0, 80)})`; }
}

export async function profecoHarvest(): Promise<HarvestResult> {
  const idxRes = await fetch(INDEX_URL, { headers: UA });
  if (!idxRes.ok) throw new SourceError(`Profeco index page returned HTTP ${idxRes.status}`);
  const links = parseIndex(await idxRes.text());
  if (!links.length) throw new SourceError("Profeco index page lists no yearly files (layout changed?)");
  const dir = mkdtempSync(join(tmpdir(), "profeco-"));
  try {
    const newest = new Newest();
    let read = 0, kept = 0, files = 0, diagFirst = "";
    // newest year first; if the newest year has fewer than WINDOW_DAYS of data (early January) the previous year is added
    for (const link of links.slice(0, 2)) {
      const buf = await downloadFully(link.url, link.year);
      const out = join(dir, String(link.year));
      extractYearly(buf, dir, out, link.year);
      const csvs = listCsv(out);
      if (!csvs.length) throw new SourceError(`Profeco ${link.year} archive held no CSV files`);
      if (!kept && !read) diagFirst = csvs.length ? describeFirstRow(readFileSync(csvs[csvs.length - 1])) : "";
      for (const f of csvs.slice(-2)) { // the newest two monthly files cover the 30-day window even right after a month change
        const r = parsePrices(decodeText(readFileSync(f)), newest);
        read += r.rows; kept += r.kept; files++;
      }
      if (newest.newestDate && Number(newest.newestDate.slice(5, 7)) > 1) break;
    }
    const built = buildRows(newest.entries(), newest.newestDate);
    if (!built.rows.length || !built.date) throw new SourceError(`Profeco files held no usable prices (${read} rows read, ${kept} kept; newest file: ${diagFirst})`);
    return {
      date: built.date,
      currency: "MXN",
      unit: "per pack named in the item",
      rows: built.rows,
      note: `${files} monthly files, ${read} rows read, ${kept} kept; newest day ${built.date}; ${built.items} products, ${built.states.length} states; ${built.dropped.outliers} outlier prices dropped.`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- matching (Spanish names; English words through a small gloss) ----------
export const GLOSS: Record<string, string> = {
  leche: "milk", huevo: "egg eggs", pollo: "chicken", arroz: "rice", frijol: "beans", azucar: "sugar", aceite: "oil", tortilla: "tortilla", pan: "bread",
  atun: "tuna", sardina: "sardines sardine", jabon: "soap", papel: "paper", higienico: "toilet", detergente: "detergent", cafe: "coffee", harina: "flour",
  sal: "salt", pasta: "pasta noodles spaghetti", sopa: "soup pasta", galletas: "cookies biscuits", refresco: "soda soft drink", agua: "water", cerveza: "beer",
  jamon: "ham", queso: "cheese", mantequilla: "butter", crema: "cream", yogurt: "yogurt yoghurt", carne: "meat beef", res: "beef", cerdo: "pork", tomate: "tomato",
  cebolla: "onion", papa: "potato", manzana: "apple", platano: "banana", limon: "lemon lime", aguacate: "avocado", chile: "chilli chili", maiz: "corn", avena: "oats oatmeal",
  cereal: "cereal", salchicha: "sausage hot dog", mayonesa: "mayonnaise", catsup: "ketchup", mostaza: "mustard", shampoo: "shampoo", dental: "toothpaste toothbrush",
  panal: "diaper nappy", desodorante: "deodorant", rastrillo: "razor", chocolate: "chocolate", mermelada: "jam", lenteja: "lentils", garbanzo: "chickpeas chickpea",
  vinagre: "vinegar", servilleta: "napkin tissue", cloro: "bleach", suavizante: "softener fabric", jugo: "juice", nectar: "juice nectar", te: "tea", vaso: "glass cup",
  ultrapasteurizada: "uht", deslactosada: "lactose free", entera: "whole full fat", light: "light", descremada: "skimmed skim", blanco: "white", integral: "wholegrain",
  toalla: "towel", sanitaria: "sanitary pad pads", pasta_dental: "toothpaste", crema_dental: "toothpaste", pila: "battery", foco: "bulb light", licuadora: "blender",
};
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "kg", "in", "mexico", "how", "much", "is", "for", "retail", "de", "del", "la", "el", "un", "una", "precio", "precios"]);
const QUERY_SYNONYMS: Record<string, string> = { chilies: "chilli", chillies: "chilli", eggs: "egg", frijoles: "frijol", huevos: "huevo" };

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
    scored.push({ d, s: 100 - 4 * Math.max(0, own.length - words.length) });
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

const STATE_ALIASES: Record<string, string> = {
  cdmx: "ciudad de mexico", df: "ciudad de mexico", "mexico city": "ciudad de mexico", "distrito federal": "ciudad de mexico", edomex: "estado de mexico", "state of mexico": "estado de mexico",
  jalisco: "jalisco", "nuevo leon": "nuevo leon", "baja california": "baja california", yucatan: "yucatan", michoacan: "michoacan de ocampo", veracruz: "veracruz de ignacio de la llave",
  coahuila: "coahuila de zaragoza",
};

/** The library's state name for what the caller typed, or null. */
export function resolveState(rows: DailyRow[], region: string): string | null {
  const states = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q0 = norm(region);
  const q = STATE_ALIASES[q0] ?? q0;
  if (!q) return null;
  return states.find((s) => norm(s) === q) ?? states.find((s) => norm(s).includes(q)) ?? null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across shops, of each shop's newest price for the product and pack in Profeco's Quien es Quien en los Precios over the last 30 days of data, in Mexican pesos. " +
    "Posted shelf prices recorded by Profeco inspectors, not receipts; brands are pooled; n is the number of shops (5 or more needed)."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function profecoAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday product in plain words such as 'milk', 'eggs', 'tortilla', 'rice', 'cooking oil', 'sugar' or 'leche'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let place = "Mexico";
  if (region) {
    const st = resolveState(day.rows, region);
    if (!st) {
      const states = [...new Set(day.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (no product priced in 5 or more shops there, or not a Mexican state). States with figures: ${states.join(", ")}. Leave region out for the national figure.`);
    }
    area = st;
    place = st;
  }
  const from = isoOf(dayNumber(day.date) - (WINDOW_DAYS - 1));
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country: "MX", item, ...(region ? { region } : {}) }, summary: null, currency: "MXN", unit: "per pack",
      period: { from, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  const hits = matchItems(defsFor(day.rows, area), item);
  if (!hits.length) {
    const all = matchItems(defsFor(day.rows, NATIONAL), item);
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.name))].sort().slice(0, 30);
    return empty(
      area !== NATIONAL && all.length
        ? `Fewer than 5 shops in ${place} priced '${item}' in the last 30 days of data. Leave region out for the national figure.`
        : `No product matching '${item}' is priced in 5 or more shops in our copy. Products held include: ${names.join("; ")}.`,
    );
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > 75; // the publisher itself runs about 7 weeks behind
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${d.pack}`);
  return buildAnswer({
    source: INFO,
    query: { country: "MX", item: `${best.name}, ${best.pack}`, ...(region ? { region: place } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "MXN",
    unit: `per ${best.pack}`,
    period: { from, to: day.date },
    method: methodText(),
    describe: (x) =>
      `Profeco shelf prices in ${place} put ${best.name} (${best.pack}) at a median of ${fmtMoney(x.median, "MXN")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "MXN")}–${fmtMoney(x.high, "MXN")} across shops. ` +
      `These are posted shelf prices recorded by Profeco inspectors, not receipts; newest prices are from ${day.date}.` +
      (stale ? ` The newest data is ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      shops: r.n,
      area: place,
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { stale: true, days_since_newest: ageDays } : {}),
    },
  });
}

export async function profecoPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Profeco price file daily; data appears after the next collection.");
  return profecoAnswerFromRows(day, input);
}

export function profecoHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveState(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name}, ${area === NATIONAL ? "Mexico" : area}` } : null;
  } catch {
    return null;
  }
}
