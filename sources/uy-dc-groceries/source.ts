// Uruguay "Sistema de Informacion de Precios al Consumidor" (SIPC, Defensa del Consumidor, Ministerio de Economia y Finanzas):
// shelf prices of everyday products that shops (supermarkets, minimarkets, street markets) report every day. The 2026 file is about 1.5 GB
// (one row per price, per shop, per product, per day), so we never read it per request. The daily collector (harvest) asks only for the LAST
// ~48 MB of the file with an HTTP Range request (the file grows at the end), keeps each shop's newest regular price per product and pack over
// the last 7 days of data, and stores one aggregate per department and product in the price library. Requests are answered from the library.
// POSTED shelf prices in Uruguayan pesos (IVA included), not receipts. Shop names, addresses and coordinates are never read into the library.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "uy-dc-groceries",
  country: "Uruguay",
  category: "groceries (shop shelf prices of everyday goods)",
  name: "Sistema de Informacion de Precios al Consumidor (Defensa del Consumidor)",
  publisher: "Area Defensa del Consumidor, Ministerio de Economia y Finanzas (Uruguay), via the national open-data catalogue catalogodatos.gub.uy",
  what_is_recorded:
    "The shelf price of one everyday product and pack (basic foods, fresh fruit and vegetables, drinks, cleaning and personal-care goods, school supplies) in one shop or street market on one day, as reported to the consumer ministry, in Uruguayan pesos with IVA included.",
  price_type: "posted_price",
  freshness: "Daily file; the newest day in it is usually several weeks behind",
  licence: "Licencia de Datos Abiertos - Uruguay v0.1 (commercial and non-commercial reuse allowed, with a source note)",
  licence_url: "https://www.gub.uy/agencia-gobierno-electronico-sociedad-informacion-conocimiento/sites/agencia-gobierno-electronico-sociedad-informacion-conocimiento/files/documentos/publicaciones/licencia_de_datos_abiertos_0.pdf",
  attribution:
    "Source: Defensa del Consumidor, Ministerio de Economia y Finanzas (Uruguay), Sistema de Informacion de Precios al Consumidor, catalogodatos.gub.uy, under the Licencia de Datos Abiertos - Uruguay. Accessed by ProofPrice; changed by ProofPrice: for each product and pack we take every shop's newest regular price over 7 days and report the median and 10th to 90th percentile across shops, by department. Not endorsed by the publisher.",
  homepage: "https://catalogodatos.gub.uy/dataset/defensa-del-consumidor-sistema-de-informacion-de-precios-al-consumidor-2026",
  limits:
    "Posted shelf prices reported by shops, not receipts and not what one shopper paid; the shops reporting are not a representative sample of all shops. Brands are pooled within a product and pack. " +
    "Special-offer prices are left out. Only the products and packs priced in the most shops are kept, a department needs 5 or more shops for a product, and prices more than 4 times above or below the product's national median are dropped as entry errors. " +
    "Shop names, addresses and coordinates are not stored.",
};

export const CKAN = "https://catalogodatos.gub.uy/api/3/action/package_show?id=";
export const DATASET = (year: number) => `defensa-del-consumidor-sistema-de-informacion-de-precios-al-consumidor-${year}`;
export const WINDOW_DAYS = 7; // a shop counts when its newest price for the product is within this many days of the newest day
export const TAIL_BYTES = 48_000_000; // ~8 days of the 2026 file (about 75,000 rows a day at ~75 bytes)
export const KEEP_ITEMS = 160;
export const OUTLIER_FACTOR = 4;
export const STALE_AFTER_DAYS = 75;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
export const FERIA = "(feria)"; // street markets report no department: they count in the national figure only

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The small files (products, shops) are Windows-1252 text. */
export function decodeLatin(buf: Buffer | Uint8Array): string {
  return new TextDecoder("windows-1252").decode(buf);
}

/** One CSV line with comma separators and double-quoted fields. */
export function splitComma(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Product { name: string; pack: string }

/** productos.csv (semicolons): id.producto;producto;marca;especificacion;nombre. Brand is dropped: brands are pooled. */
export function parseProducts(text: string): Map<number, Product> {
  const out = new Map<number, Product>();
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(";").map((x) => x.trim().toLowerCase());
  const iId = head.indexOf("id.producto"), iName = head.indexOf("producto"), iPack = head.indexOf("especificacion");
  if (iId < 0 || iName < 0 || iPack < 0) throw new SourceError("Uruguay products file changed shape (columns id.producto, producto, especificacion not found)");
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue;
    const c = l.split(";");
    const id = Number(c[iId]);
    const name = clean(c[iName] ?? ""), pack = clean(c[iPack] ?? "");
    if (Number.isInteger(id) && name) out.set(id, { name, pack });
  }
  return out;
}

/** establecimiento.csv (semicolons): only the id and the department are read; addresses, names and coordinates are ignored. */
export function parseShops(text: string): Map<number, string> {
  const out = new Map<number, string>();
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(";").map((x) => x.trim().toLowerCase());
  const iId = head.indexOf("id.establecimientos"), iDep = head.indexOf("depto");
  if (iId < 0 || iDep < 0) throw new SourceError("Uruguay shops file changed shape (columns id.establecimientos, depto not found)");
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue;
    const c = l.split(";");
    const id = Number(c[iId]);
    const dep = clean(c[iDep] ?? "");
    if (Number.isInteger(id) && dep) out.set(id, dep);
  }
  return out;
}

export const itemKey = (p: Product) => `${p.name}|${p.pack}`;

export interface Seen { date: string; price: number; item: string; area: string }

/** Keeps, for every shop and item, the newest price (a shop key lives only in memory). */
export class Newest {
  private map = new Map<string, Seen>();
  newestDate = "";
  add(shop: string, item: string, area: string, date: string, price: number): void {
    if (date > this.newestDate) this.newestDate = date;
    const k = `${shop}\u0000${item}`;
    const cur = this.map.get(k);
    if (!cur || date > cur.date) this.map.set(k, { date, price, item, area });
  }
  get size(): number { return this.map.size; }
  entries(): Seen[] { return [...this.map.values()]; }
}

export interface ParseStats { rows: number; kept: number; offers: number; partial: number; unknownProduct: number; unknownShop: number }

/** Parse the price rows (comma CSV with a header; the first line may be a cut-off fragment when the text came from a Range read). */
export function parsePrices(text: string, products: Map<number, Product>, shops: Map<number, string>, into: Newest): ParseStats {
  const st: ParseStats = { rows: 0, kept: 0, offers: 0, partial: 0, unknownProduct: 0, unknownShop: 0 };
  const lines = text.split("\n");
  let head: string[] | null = null;
  let start = 0;
  // a Range read starts mid-row: skip lines until the header, or, when there is no header, drop the first (cut) line
  const h = lines.findIndex((l) => /^"?ID_PrecioDiario"?,/.test(l));
  if (h >= 0 && h < 3) { head = splitComma(lines[h].replace(/\r$/, "")).map((x) => x.trim().toLowerCase()); start = h + 1; } else start = 1;
  const col = (name: string, fallback: number) => (head ? head.indexOf(name) : fallback);
  const iDate = col("fecha", 2), iOffer = col("oferta", 4), iPrice = col("precio", 5), iShop = col("establecimiento", 8), iFeria = col("feria_id", 9), iProd = col("presentacion_producto", 10);
  if ([iDate, iOffer, iPrice, iShop, iFeria, iProd].some((i) => i < 0)) throw new SourceError("Uruguay price file changed shape (columns Fecha, Oferta, Precio, Establecimiento, Feria_id, Presentacion_Producto not all found)");
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const c = splitComma(line);
    if (c.length < 11) { st.partial++; continue; } // the last line of a Range read can be cut
    st.rows++;
    const price = Number(c[iPrice]);
    const date = c[iDate];
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (c[iOffer] !== "0") { st.offers++; continue; } // special offers are not the regular shelf price
    const prod = products.get(Number(c[iProd]));
    if (!prod) { st.unknownProduct++; continue; }
    const shopId = c[iShop] === "\\N" ? NaN : Number(c[iShop]);
    let shop: string, area: string;
    if (Number.isInteger(shopId)) {
      const dep = shops.get(shopId);
      if (!dep) { st.unknownShop++; continue; }
      shop = `s${shopId}`; area = dep;
    } else if (c[iFeria] && c[iFeria] !== "\\N") { shop = `f${c[iFeria]}`; area = FERIA; } else { st.unknownShop++; continue; }
    into.add(shop, itemKey(prod), area, date, price);
    st.kept++;
  }
  return st;
}

export interface Built { rows: DailyRow[]; date: string | null; items: number; areas: string[]; dropped: { outliers: number } }

/** Library rows for the newest day: area = department (or ALL), item = "<product>|<pack>"; n = shops. Keeps the KEEP_ITEMS products priced in the most shops. */
export function buildRows(entries: Seen[], newestDate: string, keepItems = KEEP_ITEMS): Built {
  if (!newestDate) return { rows: [], date: null, items: 0, areas: [], dropped: { outliers: 0 } };
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
    recs.push({ area: e.area, item: e.item, price: e.price });
  }
  const rows = aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH && r.area !== FERIA);
  const areas = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  return { rows, date: newestDate, items: new Set(rows.map((r) => r.item)).size, areas, dropped: { outliers } };
}

/** The file URLs of one yearly dataset from the CKAN package_show answer. */
export function pickFiles(json: any, year: number): { prices: string; products: string; shops: string } {
  const res: { url?: string; name?: string }[] = json?.result?.resources;
  if (!Array.isArray(res)) throw new SourceError(`Uruguay catalogue answer for ${year} has no resources`);
  const find = (re: RegExp) => res.find((r) => typeof r.url === "string" && re.test(r.url.split("?")[0].toLowerCase()))?.url;
  const prices = find(new RegExp(`/precios[_-]?${year}\\.csv$`)), products = find(/\/productos\.csv$/), shops = find(/\/establecimientos?\.csv$/);
  if (!prices || !products || !shops) throw new SourceError(`Uruguay ${year} dataset lacks precios_${year}.csv, productos.csv or establecimiento.csv`);
  return { prices, products, shops };
}

async function getBuffer(url: string, what: string): Promise<Buffer> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new SourceError(`Uruguay ${what} returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The last `bytes` of a big file with Range requests; resumes when the connection drops. Refuses to download the whole file if the server ignores Range. */
export async function downloadTail(url: string, bytes = TAIL_BYTES, tries = 6): Promise<Buffer> {
  let parts: Buffer[] = [];
  let have = 0, start = -1, end = -1;
  for (let i = 0; i < tries; i++) {
    const range = start < 0 ? `bytes=-${bytes}` : `bytes=${start + have}-${end}`;
    let res: Response;
    try { res = await fetch(url, { headers: { ...UA, Range: range } }); } catch { continue; }
    if (res.status === 416 && have) break;
    if (res.status !== 206) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new SourceError(`Uruguay price file ignored the Range request (HTTP ${res.status}); not downloading 1.5 GB`); }
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(res.headers.get("content-range") || "");
    if (start < 0) { if (!m) throw new SourceError("Uruguay price file answered 206 without a Content-Range"); start = Number(m[1]); end = Number(m[2]); }
    const reader = res.body!.getReader();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { break; }
      if (chunk.done) break;
      parts.push(Buffer.from(chunk.value)); have += chunk.value.length;
    }
    if (start + have > end) break;
  }
  if (start < 0 || start + have <= end) throw new SourceError(`Uruguay price file tail incomplete: ${have} of ${end - start + 1} bytes`);
  return Buffer.concat(parts);
}

export async function uyHarvest(now: Date = new Date()): Promise<HarvestResult> {
  const year = now.getUTCFullYear();
  const newest = new Newest();
  let read = 0, kept = 0, offers = 0, files = 0, used = 0;
  // newest year first; early in January the previous year's tail is added when the new file is missing or too short for a week
  for (const y of [year, year - 1]) {
    let pkg: any;
    const r = await fetch(CKAN + DATASET(y), { headers: UA });
    if (r.status === 404 && y === year) continue; // the new year's dataset may not exist yet
    if (!r.ok) throw new SourceError(`Uruguay catalogue returned HTTP ${r.status} for ${y}`);
    try { pkg = await r.json(); } catch { throw new SourceError(`Uruguay catalogue answer for ${y} was not JSON`); }
    if (pkg?.success === false) { if (y === year) continue; throw new SourceError(`Uruguay catalogue has no dataset for ${y}`); }
    const f = pickFiles(pkg, y);
    const products = parseProducts(decodeLatin(await getBuffer(f.products, "products file")));
    const shops = parseShops(decodeLatin(await getBuffer(f.shops, "shops file")));
    const tail = await downloadTail(f.prices);
    const st = parsePrices(tail.toString("utf8"), products, shops, newest);
    read += st.rows; kept += st.kept; offers += st.offers; files++;
    used = st.kept;
    const days = newest.newestDate ? new Set(newest.entries().map((e) => e.date)).size : 0;
    if (used > 0 && days >= WINDOW_DAYS) break;
  }
  const built = buildRows(newest.entries(), newest.newestDate);
  if (!built.rows.length || !built.date) throw new SourceError(`Uruguay files held no usable prices (${files} tails, ${read} rows read, ${kept} kept, ${offers} offers skipped)`);
  return {
    date: built.date,
    currency: "UYU",
    unit: "per pack named in the item",
    rows: built.rows,
    note: `${files} file tails, ${read} rows read, ${kept} regular prices kept, ${offers} offer prices skipped; newest day ${built.date}; ${built.items} products, ${built.areas.length} departments; ${built.dropped.outliers} outlier prices dropped.`,
  };
}

// ---------- matching (Spanish names; English words through a small gloss) ----------
export const GLOSS: Record<string, string> = {
  aceite: "oil cooking", girasol: "sunflower", maiz: "corn maize", soja: "soy soya", arroz: "rice", azucar: "sugar", cafe: "coffee", carne: "meat beef", vacuna: "beef", vacuno: "beef",
  picada: "mince minced ground", cerveza: "beer", champu: "shampoo", huevos: "egg eggs", harina: "flour", fideos: "pasta noodles spaghetti", jabon: "soap", papel: "paper", higienico: "toilet",
  pollo: "chicken", pan: "bread", queso: "cheese", jamon: "ham", manteca: "butter", margarina: "margarine", mayonesa: "mayonnaise", mermelada: "jam", pescado: "fish", sal: "salt", te: "tea",
  vino: "wine", yerba: "mate", yogur: "yogurt yoghurt", tomate: "tomato", papa: "potato", cebolla: "onion", zanahoria: "carrot", banana: "banana", manzana: "apple", naranja: "orange",
  limon: "lemon", frutilla: "strawberry", zapallo: "pumpkin squash", boniato: "sweet potato", lechuga: "lettuce", panales: "nappies diapers diaper nappy", dental: "toothpaste",
  desodorante: "deodorant", detergente: "detergent", gaseosa: "soda soft drink cola", agua: "water", helado: "ice cream", galletitas: "biscuits cookies crackers", hipoclorito: "bleach",
  sandia: "watermelon", pera: "pear", durazno: "peach", uva: "grape grapes", mandarina: "mandarin tangerine", pomelo: "grapefruit", ciruela: "plum", brocoli: "broccoli", coliflor: "cauliflower",
  repollo: "cabbage", espinaca: "spinach", acelga: "chard", choclo: "sweetcorn", pepino: "cucumber", morron: "pepper", berenjena: "eggplant aubergine", chorizos: "sausage sausages",
  hamburguesas: "burgers hamburger", frankfurters: "hot dogs frankfurter", pulpa: "paste puree", cuaderno: "notebook", lapiz: "pencil", boligrafo: "pen", afeitadora: "razor", toallitas: "wipes sanitary pads",
  talco: "talc talcum", alcohol: "alcohol", algodon: "cotton wool", repelente: "repellent", protector: "sunscreen sunblock", cocoa: "cocoa", membrillo: "quince",
  blanco: "white", colorados: "brown", entero: "whole", fresco: "fresh", cocido: "cooked", tinto: "red", seca: "dry", secos: "dry", rallado: "grated", molde: "sliced loaf", flauta: "baguette",
  paleta: "shoulder", nalga: "rump", peceto: "eye round", rueda: "round", aguja: "chuck", leonesa: "luncheon meat",
};
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "kg", "in", "uruguay", "how", "much", "is", "for", "retail", "de", "del", "la", "el", "un", "una", "precio", "precios", "con", "en", "sin"]);
const QUERY_SYNONYMS: Record<string, string> = { eggs: "egg", huevo: "huevos", nappy: "nappies", diaper: "nappies", diapers: "nappies", chilies: "chilli" };

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
    if (!words.every((w) => wordsOf(d.name).has(w))) continue;
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

/** The library's department name for what the caller typed, or null. */
export function resolveArea(rows: DailyRow[], region: string): string | null {
  const areas = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q = norm(region);
  if (!q) return null;
  return areas.find((s) => norm(s) === q) ?? areas.find((s) => norm(s).includes(q)) ?? null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across shops, of each shop's newest regular (non-offer) price for the product and pack in Uruguay's Sistema de Informacion de Precios al Consumidor over the last 7 days of data, in Uruguayan pesos with IVA. " +
    "Posted shelf prices reported to the consumer ministry, not receipts; brands are pooled; n is the number of shops (5 or more needed)."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function uyAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday product in plain words such as 'rice', 'sugar', 'eggs', 'chicken', 'bananas', 'cooking oil' or 'arroz'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let place = "Uruguay";
  if (region) {
    const a = resolveArea(day.rows, region);
    if (!a) {
      const areas = [...new Set(day.rows.map((r) => r.area))].filter((x) => x !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (no product priced in 5 or more shops there, or not a Uruguayan department). Departments with figures: ${areas.join(", ")}. Leave region out for the national figure.`);
    }
    area = a;
    place = a;
  }
  const from = isoOf(dayNumber(day.date) - (WINDOW_DAYS - 1));
  const natDefs = defsFor(day.rows, NATIONAL);
  const hits = matchItems(defsFor(day.rows, area), item);
  if (!hits.length) {
    const names = [...new Set(natDefs.map((d) => d.name))].sort().slice(0, 40);
    if (!matchItems(natDefs, item).length)
      throw new InputError(`item '${item}' not recognised: it matches no product priced in 5 or more shops in our copy. Send an everyday product in plain words such as 'rice', 'sugar', 'eggs', 'chicken', 'bananas' or 'cooking oil'. Products held include: ${names.join("; ")}.`);
    return buildAnswer({
      source: INFO, query: { country: "UY", item, ...(region ? { region } : {}) }, summary: null, currency: "UYU", unit: "per pack",
      period: { from, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: `Fewer than 5 shops in ${place} priced '${item}' in the last 7 days of data. Leave region out for the national figure.` },
    });
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${d.pack}`);
  return buildAnswer({
    source: INFO,
    query: { country: "UY", item: `${best.name}, ${best.pack}`, ...(region ? { region: place } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "UYU",
    unit: `per ${best.pack}`,
    period: { from, to: day.date },
    method: methodText(),
    describe: (x) =>
      `Shelf prices reported to Uruguay's consumer ministry put ${best.name} (${best.pack}) in ${place} at a median of ${fmtMoney(x.median, "UYU")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "UYU")}–${fmtMoney(x.high, "UYU")} across shops. ` +
      `These are posted shelf prices (special offers left out), not receipts; the newest prices in the file are from ${day.date}.` +
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

export async function uyPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Uruguay consumer price file daily; data appears after the next collection.");
  return uyAnswerFromRows(day, input);
}

export function uyHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveArea(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name}, ${area === NATIONAL ? "Uruguay" : area}` } : null;
  } catch {
    return null;
  }
}
