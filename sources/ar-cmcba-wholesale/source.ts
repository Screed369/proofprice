// Argentina wholesale fruit and vegetable prices: the daily price lists of the Mercado Central de Buenos Aires (CMCBA, Corporacion del Mercado Central de Buenos Aires).
// Format checked 2026-11-09 from the workspace (plain GET, no key): https://mercadocentral.gob.ar/informaci%C3%B3n/precios-mayoristas lists one ZIP per month and kind
// (fruit: FRUTAS_OCTUBRE_26.zip, vegetables: HORTALIZA_OCTUBRE_26_0.zip; the file names are NOT regular, so we read the month out of the name). Each ZIP holds one file per working day:
// RF<ddmmyy>.XLS (fruit) and RH<ddmmyy>.XLS (vegetables). These are Excel 2.0 / BIFF2 files (a bare record stream, not an OLE2 compound file), with the header
// ESP VAR PROC ENV KG CAL TAM GRADO MA<ddmmyy> MO<ddmmyy> MI<ddmmyy> MAPK MOPK MIPK
// = species, variety, origin (province or country), container, container weight (kg), calibre/class, size, grade, then the highest / most common (modal) / lowest price in ARS per container
// and the same three per kg (MAPK/MOPK/MIPK). Rows whose VAR is "Prom.Esp." are the species average and are left out. Text is DOS code page 437 (0xA5 is N with tilde).
// Licence: "La CMCBA licencia todos sus contenidos bajo la licencia Creative Commons Atribucion 2.5 Argentina" (terms page, read by the Verifier 2026-11-09).

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { aggregateDaily } from "../../lib/library/aggregate";
import { unzipAll } from "../../categories/rent/xlsx";

export const PAGE_URL = "https://mercadocentral.gob.ar/informaci%C3%B3n/precios-mayoristas";
export const TERMS_URL = "https://mercadocentral.gob.ar/paginas/t%C3%A9rminos-y-condiciones";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "ar-cmcba-wholesale",
  country: "AR (Argentina)",
  category: "wholesale fruit and vegetable markets",
  name: "Mercado Central de Buenos Aires: daily wholesale price lists for fruit and vegetables",
  publisher: "Corporacion del Mercado Central de Buenos Aires (CMCBA)",
  what_is_recorded:
    "The most common (modal) wholesale price, in Argentine pesos (ARS) per kilogram, that the market's own price staff recorded for one variety, origin, container and grade of a fruit or vegetable on one working day at the Mercado Central de Buenos Aires.",
  price_type: "posted_price",
  freshness: "Daily on working days, published in monthly ZIP files; the newest day is usually the previous working day",
  licence: "Creative Commons Attribution 2.5 Argentina (CC BY 2.5 AR)",
  licence_url: TERMS_URL,
  attribution:
    "Source: Corporacion del Mercado Central de Buenos Aires (CMCBA), Precios mayoristas (mercadocentral.gob.ar), CC BY 2.5 Argentina. Prices are converted to ARS per kg by the publisher; ranges are calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Posted wholesale prices recorded by the market's staff at ONE market (Buenos Aires), not individual sale records, not shop prices and not farm-gate prices. " +
    "Each record is one variety, origin, container and grade on one day, so the range also shows grade and origin differences. The publisher gives no volumes.",
};

export const METHOD =
  "Argentina wholesale produce: the most common (modal) price per kg that the Mercado Central de Buenos Aires price staff record each working day for every variety, origin, container and grade, " +
  "read from the market's daily files. We pool every record of the newest three trading days and give the median, the 10th to 90th percentile and the lowest and highest. " +
  "These are posted wholesale prices recorded by the market, not individual sales.";

// ---------- products ----------

/** Market species names (accents removed, upper case) per English name, and which monthly file holds them. */
export const PRODUCTS: Record<string, { kind: "fruit" | "veg"; names: string[] }> = {
  apple: { kind: "fruit", names: ["MANZANA"] }, banana: { kind: "fruit", names: ["BANANA"] }, pineapple: { kind: "fruit", names: ["ANANA"] },
  avocado: { kind: "fruit", names: ["PALTA"] }, lemon: { kind: "fruit", names: ["LIMON"] }, grapes: { kind: "fruit", names: ["UVA"] },
  strawberry: { kind: "fruit", names: ["FRUTILLA"] }, mandarin: { kind: "fruit", names: ["MANDARINA"] }, orange: { kind: "fruit", names: ["NARANJA"] },
  pear: { kind: "fruit", names: ["PERA"] }, kiwi: { kind: "fruit", names: ["KIWI"] }, melon: { kind: "fruit", names: ["MELON"] }, plum: { kind: "fruit", names: ["CIRUELA"] },
  peach: { kind: "fruit", names: ["DURAZNO"] }, blueberry: { kind: "fruit", names: ["ARANDANO"] }, mango: { kind: "fruit", names: ["MANGO"] },
  grapefruit: { kind: "fruit", names: ["POMELO"] }, watermelon: { kind: "fruit", names: ["SANDIA"] }, pomegranate: { kind: "fruit", names: ["GRANADA"] },
  quince: { kind: "fruit", names: ["MEMBRILLO"] }, plantain: { kind: "fruit", names: ["PLATANO"] },
  tomato: { kind: "veg", names: ["TOMATE"] }, garlic: { kind: "veg", names: ["AJO"] }, "bell pepper": { kind: "veg", names: ["PIMIENTO"] },
  lettuce: { kind: "veg", names: ["LECHUGA"] }, zucchini: { kind: "veg", names: ["ZAPALLITO"] }, onion: { kind: "veg", names: ["CEBOLLA"] },
  potato: { kind: "veg", names: ["PAPA"] }, cabbage: { kind: "veg", names: ["REPOLLO"] }, carrot: { kind: "veg", names: ["ZANAHORIA"] },
  pumpkin: { kind: "veg", names: ["ZAPALLO"] }, "green beans": { kind: "veg", names: ["CHAUCHA"] }, mushrooms: { kind: "veg", names: ["HONGOS"] },
  chard: { kind: "veg", names: ["ACELGA"] }, "sweet potato": { kind: "veg", names: ["BATATA"] }, eggplant: { kind: "veg", names: ["BERENJENA"] },
  broccoli: { kind: "veg", names: ["BROCOLI"] }, cucumber: { kind: "veg", names: ["PEPINO"] }, beetroot: { kind: "veg", names: ["REMOLACHA"] },
  celery: { kind: "veg", names: ["APIO"] }, "sweet corn": { kind: "veg", names: ["CHOCLO"] }, spinach: { kind: "veg", names: ["ESPINACA"] },
  ginger: { kind: "veg", names: ["JENGIBRE"] }, parsley: { kind: "veg", names: ["PEREJIL"] }, cauliflower: { kind: "veg", names: ["COLIFLOR"] },
  artichoke: { kind: "veg", names: ["ALCAUCIL"] }, asparagus: { kind: "veg", names: ["ESPARRAGO"] }, leek: { kind: "veg", names: ["PUERRO"] },
  peas: { kind: "veg", names: ["ARVEJA"] }, radish: { kind: "veg", names: ["RABANITO"] }, cassava: { kind: "veg", names: ["MANDIOCA"] }, kale: { kind: "veg", names: ["KALE"] },
  arugula: { kind: "veg", names: ["RUCULA"] },
};

const ALIASES: Record<string, string> = {
  manzana: "apple", manzanas: "apple", apples: "apple", bananas: "banana", anana: "pineapple", pineapples: "pineapple", palta: "avocado", avocados: "avocado",
  limon: "lemon", lemons: "lemon", uva: "grapes", grape: "grapes", frutilla: "strawberry", strawberries: "strawberry", mandarina: "mandarin", mandarins: "mandarin",
  naranja: "orange", oranges: "orange", pera: "pear", pears: "pear", kiwis: "kiwi", melones: "melon", melons: "melon", ciruela: "plum", plums: "plum",
  durazno: "peach", peaches: "peach", arandano: "blueberry", blueberries: "blueberry", mangos: "mango", mangoes: "mango", pomelo: "grapefruit",
  sandia: "watermelon", granada: "pomegranate", membrillo: "quince", platano: "plantain", tomate: "tomato", tomatoes: "tomato", ajo: "garlic",
  pimiento: "bell pepper", pepper: "bell pepper", peppers: "bell pepper", lechuga: "lettuce", zapallito: "zucchini", courgette: "zucchini", cebolla: "onion",
  onions: "onion", papa: "potato", papas: "potato", potatoes: "potato", repollo: "cabbage", cabbages: "cabbage", zanahoria: "carrot", carrots: "carrot",
  zapallo: "pumpkin", squash: "pumpkin", chaucha: "green beans", "green bean": "green beans", hongos: "mushrooms", mushroom: "mushrooms", champinon: "mushrooms",
  acelga: "chard", batata: "sweet potato", "sweet potatoes": "sweet potato", berenjena: "eggplant", aubergine: "eggplant", brocoli: "broccoli",
  pepino: "cucumber", cucumbers: "cucumber", remolacha: "beetroot", beets: "beetroot", beet: "beetroot", apio: "celery", choclo: "sweet corn", corn: "sweet corn",
  espinaca: "spinach", jengibre: "ginger", perejil: "parsley", coliflor: "cauliflower", alcaucil: "artichoke", artichokes: "artichoke", esparrago: "asparagus",
  puerro: "leek", leeks: "leek", arveja: "peas", pea: "peas", rabanito: "radish", radishes: "radish", mandioca: "cassava", rucula: "arugula", rocket: "arugula",
};

export const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface Product { key: string; kind: "fruit" | "veg"; names: string[] }

export function resolveProduct(input: string): Product | null {
  const lc = plain(input);
  const key = PRODUCTS[lc] ? lc : ALIASES[lc];
  if (key && PRODUCTS[key]) return { key, ...PRODUCTS[key] };
  return null;
}

export const productHelp = () => Object.keys(PRODUCTS).join(", ");

export const unknownProduct = (asked: string) =>
  `Argentina: '${asked}' is not one of the products we know. Use one of: ${productHelp()} (or the Spanish name such as manzana, tomate, papa).`;

// ---------- reading the BIFF2 .xls ----------

export type Cell = string | number;

/**
 * Cells of the first sheet of an Excel 2.0 (BIFF2) file as rows of cells. Reads BOF, DIMENSIONS, BLANK, INTEGER, NUMBER and LABEL records, which is all these files hold.
 * Anything else (a real OLE2 workbook, BIFF3 and later) is a SourceError, so a change of format is reported instead of being misread.
 */
export function readBiff2(buf: Buffer): Cell[][] {
  if (buf.length < 8) throw new SourceError("CMCBA price file is empty or too short");
  if (buf.readUInt32LE(0) === 0xe011cfd0) throw new SourceError("CMCBA price file is now an OLE2 workbook (format changed): the reader needs updating");
  if (buf.readUInt16LE(0) !== 0x0009 || buf.readUInt16LE(2) < 4 || buf.readUInt16LE(4) !== 0x0002) {
    throw new SourceError("CMCBA price file is not an Excel 2.0 (BIFF2) sheet (format changed): the reader needs updating");
  }
  const rows: Cell[][] = [];
  const put = (r: number, c: number, v: Cell) => {
    if (r > 20000 || c > 255) return;
    (rows[r] ??= [])[c] = v;
  };
  let p = 0;
  while (p + 4 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const len = buf.readUInt16LE(p + 2);
    const d = p + 4;
    if (d + len > buf.length) break;
    if (type === 0x000a) break; // EOF
    if (type === 0x0003 && len >= 15) put(buf.readUInt16LE(d), buf.readUInt16LE(d + 2), buf.readDoubleLE(d + 7)); // NUMBER
    else if (type === 0x0002 && len >= 9) put(buf.readUInt16LE(d), buf.readUInt16LE(d + 2), buf.readUInt16LE(d + 7)); // INTEGER
    else if (type === 0x0004 && len >= 8) {
      const n = buf.readUInt8(d + 7);
      put(buf.readUInt16LE(d), buf.readUInt16LE(d + 2), decode437(buf.subarray(d + 8, d + 8 + Math.min(n, len - 8))));
    }
    p = d + len;
  }
  return rows.map((r) => r ?? []);
}

/** DOS code page 437 bytes to a string; only the Spanish letters matter here. */
function decode437(b: Buffer): string {
  const map: Record<number, string> = { 0x80: "C", 0x81: "u", 0x82: "e", 0x83: "a", 0x84: "a", 0x85: "a", 0x86: "a", 0x87: "c", 0x88: "e", 0x89: "e", 0x8a: "e", 0x8b: "i", 0x8c: "i", 0x8d: "i", 0x8e: "A", 0x8f: "A", 0x90: "E", 0xa0: "a", 0xa1: "i", 0xa2: "o", 0xa3: "u", 0xa4: "n", 0xa5: "N" };
  let s = "";
  for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : (map[x] ?? "?");
  return s.trim();
}

// ---------- one day's records ----------

export interface Row { date: string; kind: "fruit" | "veg"; species: string; variety: string; origin: string; container: string; kg: number; grade: string; price: number }

/** "RF281026.XLS" to { kind: "fruit", date: "2026-10-28" }; null for any other name. */
export function dayFromName(name: string): { kind: "fruit" | "veg"; date: string } | null {
  const m = /(?:^|\/)R([FH])(\d{2})(\d{2})(\d{2})\.XLS$/i.exec(name);
  if (!m) return null;
  const [dd, mm, yy] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return { kind: m[1].toUpperCase() === "F" ? "fruit" : "veg", date: `20${m[4]}-${m[3]}-${m[2]}` };
}

const HEADER = ["ESP", "VAR", "PROC", "ENV", "KG", "CAL", "TAM", "GRADO"];

/** Usable per-kg records of one day's file. Species-average rows, zero prices and rows without a pack weight are dropped. A changed header is a SourceError. */
export function parseDay(buf: Buffer, kind: "fruit" | "veg", date: string): Row[] {
  const cells = readBiff2(buf);
  const head = (cells[0] ?? []).map((c) => String(c ?? ""));
  if (HEADER.some((h, i) => head[i] !== h) || !head.includes("MOPK")) throw new SourceError("CMCBA price file has a different header than expected (format changed): the reader needs updating");
  const iMop = head.indexOf("MOPK");
  const iMo = head.findIndex((h) => /^MO\d{6}$/.test(h));
  const out: Row[] = [];
  for (let r = 1; r < cells.length; r++) {
    const c = cells[r] ?? [];
    const species = String(c[0] ?? "").trim();
    const variety = String(c[1] ?? "").trim();
    if (!species || /^prom\.?\s*esp/i.test(variety)) continue;
    const kg = Number(c[4]);
    let price = Number(c[iMop]);
    if (!(price > 0) && iMo >= 0 && kg > 0 && Number(c[iMo]) > 0) price = Number(c[iMo]) / kg;
    if (!(price > 0) || !(kg > 0)) continue;
    out.push({ date, kind, species: plain(species).toUpperCase(), variety, origin: String(c[2] ?? "").trim(), container: String(c[3] ?? "").trim(), kg, grade: String(c[7] ?? "").trim(), price: Math.round(price * 100) / 100 });
  }
  return out;
}

// ---------- finding the monthly files ----------

export interface MonthZip { kind: "fruit" | "veg"; ym: string; url: string }

const MONTHS: [RegExp, number][] = [
  [/ENERO/, 1], [/FEBRERO/, 2], [/MARZO/, 3], [/ABRIL/, 4], [/MAYO/, 5], [/JUNIO/, 6], [/JULIO/, 7], [/AGOSTO/, 8], [/SEP?T?I?E?M?BRE|SEPT|SETIEMBRE/, 9], [/OCTUBRE/, 10], [/NOVIEMBRE/, 11], [/DICIEMBRE/, 12],
];

/** The monthly ZIP links on the price page, with kind (fruit/veg) and month read out of their irregular file names. Links we cannot place are ignored. */
export function parsePageLinks(html: string): MonthZip[] {
  const out: MonthZip[] = [];
  for (const m of html.matchAll(/href="(https?:\/\/mercadocentral\.gob\.ar\/sites\/default\/files\/precios_mayoristas\/([^"]+?\.zip))"/gi)) {
    let name: string;
    try { name = decodeURIComponent(m[2]).toUpperCase(); } catch { continue; }
    const kind = name.startsWith("FRUT") ? "fruit" : name.startsWith("HORTALIZ") ? "veg" : null;
    const month = MONTHS.find(([re]) => re.test(name))?.[1];
    const years = [...name.matchAll(/(?:20)?(2\d)(?=\D|$)/g)];
    if (!kind || !month || !years.length) continue;
    out.push({ kind, ym: `20${years[years.length - 1][1]}-${String(month).padStart(2, "0")}`, url: m[1] });
  }
  return out;
}

export type Get = (url: string) => Promise<Buffer>;

export const harvestOptions = { retryDelayMs: 2000 };

export const download: Get = async (url) => {
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (e: any) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    if (i < 2 && harvestOptions.retryDelayMs) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs));
  }
  throw new SourceError(`Mercado Central de Buenos Aires answered ${last} for ${url.replace(/^https?:\/\/[^/]+/, "")}`);
};

/** Day files of one kind from the newest months of the page, newest first: stops after `days` trading days (or when `months` months were read). */
export async function loadDays(kind: "fruit" | "veg", get: Get = download, days = 3, months = 2): Promise<{ date: string; rows: Row[] }[]> {
  const page = (await get(PAGE_URL)).toString("utf8");
  const zips = parsePageLinks(page).filter((z) => z.kind === kind).sort((a, b) => b.ym.localeCompare(a.ym));
  if (!zips.length) throw new SourceError("Mercado Central price page lists no monthly files (page layout changed).");
  const found = new Map<string, Row[]>();
  for (const z of zips.slice(0, months)) {
    const files = unzipAll(await get(z.url));
    for (const [name, buf] of files) {
      const d = dayFromName(name);
      if (!d || d.kind !== kind || !d.date.startsWith(z.ym)) continue; // a stray file from another month inside a ZIP is skipped
      found.set(d.date, parseDay(buf, kind, d.date));
    }
    if ([...found.values()].filter((r) => r.length).length >= days) break;
  }
  return [...found.entries()].filter(([, rows]) => rows.length).sort((a, b) => b[0].localeCompare(a[0])).slice(0, days).map(([date, rows]) => ({ date, rows }));
}

// ---------- the answer ----------

export interface Input { product?: string; market?: string; baseUrl?: string }

export function answerFromDays(days: { date: string; rows: Row[] }[], input: Input): PriceAnswer {
  const prod = resolveProduct(input.product ?? "");
  if (!prod) throw new InputError(unknownProduct(input.product ?? ""));
  const used = days.flatMap((d) => d.rows).filter((r) => prod.names.includes(r.species));
  const usedDates = [...new Set(used.map((r) => r.date))].sort();
  const s = summarise(used.map((r) => r.price));
  return buildAnswer({
    source: INFO,
    query: { country: "AR", product: prod.key },
    summary: s,
    currency: "ARS",
    unit: "per kg",
    period: { from: usedDates[0] ?? null, to: usedDates[usedDates.length - 1] ?? null },
    method: METHOD,
    describe: (x) => `Wholesale ${prod.key} at the Mercado Central de Buenos Aires: median ${x.median} ARS per kg (typical ${x.low} to ${x.high}).`,
    baseUrl: input.baseUrl,
    extra: {
      note: "Posted wholesale prices recorded by the market's staff at one market (Buenos Aires): not individual sales, not what a shopper pays and not what a farmer receives. All varieties, origins and grades are included.",
      markets: ["Mercado Central de Buenos Aires"],
      trading_days: usedDates,
      origins: [...new Set(used.map((r) => r.origin).filter(Boolean))].sort().slice(0, 12),
      record: "modal wholesale price of one variety, origin, container and grade on one working day",
      ...(input.market ? { market_ignored: "Only one market is published (Mercado Central de Buenos Aires), so the market filter was not applied." } : {}),
    },
  });
}

export async function arWholesale(input: Input, get: Get = download): Promise<PriceAnswer> {
  if (!input.product) throw new InputError("product is required, for example 'tomato', 'potato', 'banana' or 'apple'.");
  const prod = resolveProduct(input.product);
  if (!prod) throw new InputError(unknownProduct(input.product)); // no network call for a product we cannot match
  return answerFromDays(await loadDays(prod.kind, get), input);
}

// ---------- daily collector ----------

/** One national row per known product for one trading day, ARS per kg: median/percentiles over the day's records. Products with under 5 records are left out. */
export function harvestFromRows(rows: Row[], date: string): HarvestResult {
  const records: { area: string; item: string; price: number }[] = [];
  for (const r of rows.filter((x) => x.date === date))
    for (const [key, p] of Object.entries(PRODUCTS)) if (p.names.includes(r.species)) records.push({ area: "ALL", item: key, price: r.price });
  const out = aggregateDaily(records, false).filter((x) => x.n >= 5);
  if (!out.length) throw new SourceError(`Mercado Central price files had no usable records for ${date} (or a changed layout).`);
  return {
    date,
    currency: "ARS",
    unit: "per kg",
    rows: out,
    note: `Median, 10th to 90th percentile of the posted wholesale prices (one per variety, origin, container and grade) on ${date}, ARS per kg. Posted by the market's staff, not individual sales.`,
  };
}

export async function arHarvest(get: Get = download): Promise<HarvestResult> {
  const [fruit, veg] = await Promise.all([loadDays("fruit", get, 3, 2), loadDays("veg", get, 3, 2)]);
  // the newest day for which both files exist: a day with only one of them would drop half the products
  const vegDates = new Set(veg.map((d) => d.date));
  const date = fruit.map((d) => d.date).find((d) => vegDates.has(d)) ?? fruit[0]?.date ?? veg[0]?.date;
  if (!date) throw new SourceError("Mercado Central price files returned no records.");
  return harvestFromRows([...fruit, ...veg].flatMap((d) => d.rows), date);
}

export function arHistoryKey(p: { country: string; product: string }): { area: string; item: string; label: string } | null {
  if (String(p.country).trim().toUpperCase() !== "AR") return null;
  const prod = resolveProduct(String(p.product ?? ""));
  if (!prod) return null;
  return { area: "ALL", item: prod.key, label: `Argentina wholesale ${prod.key}` };
}
