// Israel grocery shelf prices from Shufersal, the country's largest supermarket chain. Israel's Food Law (price transparency) makes retailers publish
// every store's full price list daily; Shufersal's public file page (prices.shufersal.co.il) lists one "PriceFull" file per store (a gzipped XML with
// every item's barcode, name, pack size and shelf price). Our daily collector reads every store's file, picks a fixed basket of everyday products
// by barcode, turns each into a price per kg, per litre or per piece, and keeps ONE price per store and item (median of the store's matching barcodes).
// The answer is the median and 10th-90th percentile across stores, in shekels. POSTED shelf prices (not receipts) of ONE chain.
// Requests are answered from the library copy only: the files are ~6 MB per store x ~400 stores, far too big for a live request.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { gunzipSync } from "node:zlib";

export const INFO: SourceInfo = {
  id: "il-shufersal-groceries",
  country: "Israel",
  category: "groceries (supermarket shelf prices)",
  name: "Shufersal published price files (price transparency)",
  publisher: "Shufersal Ltd, published under Israel's Food Law price-transparency rules",
  what_is_recorded:
    "The posted shelf price, in shekels (ILS), of a fixed basket of everyday products (milk, eggs, bread, rice, flour, oil, vegetables, chicken, cottage cheese, butter) in each Shufersal store, from the store's own daily price file, shown as a price per kg, litre or piece.",
  price_type: "posted_price",
  freshness: "Daily (every store file is rebuilt overnight; our collector reads them once a day)",
  licence: "UNVERIFIED: publication is required by Israeli law but no reuse licence was found on the site. Served on the free tier only.",
  licence_url: "https://prices.shufersal.co.il/",
  attribution:
    "Source: Shufersal price transparency files (https://prices.shufersal.co.il/), published under Israel's Food Law. Changed by ProofPrice: fixed basket by barcode, converted to a price per kg, litre or piece, median and 10th to 90th percentile across stores.",
  homepage: "https://prices.shufersal.co.il/",
  limits:
    "One chain only (Shufersal, all banners: Sheli, Deal, Express, Online...), not the whole market. Posted shelf prices, not receipts and not what one shopper paid; promotions are not included. " +
    "A fixed basket of products chosen by barcode, so each item names its products. n is the number of stores (5 or more needed). Prices vary little between stores of one banner.",
};

export const LISTING_URL = (page: number) => `https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=0&page=${page}`;
export const SHUFERSAL_CHAIN_ID = "7290027600007";
export const STALE_AFTER_DAYS = 5;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)", "accept-language": "en" };

export type Unit = "kg" | "L" | "piece";
export interface BasketItem { name: string; unit: Unit; codes: string[]; pack?: number }

/** Fixed basket (barcodes read from real store files on 2026-11-07, each present in 15+ of 21 sampled stores). `pack` = pieces per pack, for unit "piece". */
export const BASKET: BasketItem[] = [
  { name: "Milk 3% fat", unit: "L", codes: ["7290102398065", "7290116936307", "7290010945306", "7290102396955", "7290000056845"] },
  { name: "Eggs (12-pack M or L)", unit: "piece", pack: 12, codes: ["7290001201862", "7290001201886"] },
  { name: "Standard sliced bread", unit: "kg", codes: ["7290018500361"] },
  { name: "Wholemeal bread", unit: "kg", codes: ["7290014940901", "7290016967074", "7290017304885", "7290013027399"] },
  { name: "White rice", unit: "kg", codes: ["7290000211169", "7290000211442"] },
  { name: "Flour", unit: "kg", codes: ["7296073472827", "7296073021575", "7296073552949", "7290100701331"] },
  { name: "Canola oil", unit: "L", codes: ["7290000144474", "7296073484011", "8410179018027", "7290002374640", "7290002692393", "7290006941466"] },
  { name: "Sunflower oil", unit: "L", codes: ["8410179018034"] },
  { name: "Tomatoes", unit: "kg", codes: ["7290000000022"] },
  { name: "Cucumbers", unit: "kg", codes: ["7290000000046"] },
  { name: "Potatoes", unit: "kg", codes: ["7290000000596", "7290000001692", "7290000001715", "7290000001722"] },
  { name: "Bananas", unit: "kg", codes: ["7290000964775"] },
  { name: "Chicken breast", unit: "kg", codes: ["7290001303207", "7290000611235", "7290000616827", "7290002649694", "7290005590320"] },
  { name: "Cottage cheese 5%", unit: "kg", codes: ["7290002868996", "7290004127329", "7290011194246"] },
  { name: "Butter", unit: "kg", codes: ["7290116932033"] },
];

const CODE_TO_ITEM = new Map<string, BasketItem>();
for (const b of BASKET) for (const c of b.codes) CODE_TO_ITEM.set(c, b);

export const itemKey = (name: string, unit: Unit): string => `${name.replace(/[|:,]/g, " ").replace(/\s+/g, " ").trim()}|${unit}`;
const unitLabel = (u: Unit) => (u === "kg" ? "per kg" : u === "L" ? "per litre" : "per piece");

// ---------- listing page ----------
export interface FileRef { url: string; file: string; chain: string; sub: string; store: string; date: string; branch: string }

const unescapeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The file list page: one row per file with a signed Azure link. Returns the PriceFull files only, plus the number of pages. */
export function parseListing(html: string): { files: FileRef[]; pages: number } {
  const files: FileRef[] = [];
  for (const rm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = /href="(https:\/\/[^"]*blob\.core\.windows\.net[^"]*)"/i.exec(rm[1]);
    if (!link) continue;
    const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => unescapeHtml(m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()));
    const file = cells.find((c) => /^PriceFull\d+-\d+-\d+-\d{8}-\d{6}$/.test(c));
    if (!file) continue; // Price (not full), Promo files and others are skipped
    const m = /^PriceFull(\d+)-(\d+)-(\d+)-(\d{4})(\d{2})(\d{2})-/.exec(file)!;
    files.push({ url: unescapeHtml(link[1]), file, chain: m[1], sub: m[2], store: m[3], date: `${m[4]}-${m[5]}-${m[6]}`, branch: cells[5] ?? "" });
  }
  if (!files.length) throw new SourceError("Shufersal's file page has a new layout: no PriceFull files found");
  const last = [...html.matchAll(/page=(\d+)"[^>]*>(?:&gt;&gt;|>>)/g)].map((m) => Number(m[1]));
  const nums = [...html.matchAll(/page=(\d+)"/g)].map((m) => Number(m[1]));
  const pages = Math.max(1, ...(last.length ? last : nums));
  return { files, pages };
}

// ---------- store file ----------
export interface ItemRecord { code: string; price: number; qty: number; uom: string }

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? m[1].trim() : "";
};

/** Items of the basket found in one store's PriceFull XML (as text). Other items are ignored. */
export function parseStoreFile(xml: string): { chain: string; store: string; items: ItemRecord[] } {
  if (!xml.includes("<Items>") && !xml.includes("<Item>")) throw new SourceError("Shufersal store file has a new layout: no Items found");
  const items: ItemRecord[] = [];
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const code = tag(m[1], "ItemCode");
    if (!CODE_TO_ITEM.has(code)) continue;
    const price = Number(tag(m[1], "ItemPrice"));
    const qty = Number(tag(m[1], "Quantity"));
    if (!(price > 0)) continue;
    items.push({ code, price, qty, uom: tag(m[1], "UnitOfMeasure") });
  }
  return { chain: tag(xml.slice(0, 600), "ChainID"), store: tag(xml.slice(0, 600), "StoreID"), items };
}

/** Price per kg, per litre or per piece of one record, or null when the pack size cannot be read. The file gives the pack quantity in the unit named by
 *  UnitOfMeasure: "1קילוגרם"/"1ליטר" mean quantity in kg/litres; "100 גרם"/"100 מיליליטר" mean quantity in grams/millilitres. */
export function unitPrice(rec: ItemRecord, item: BasketItem): number | null {
  const { price, qty, uom } = rec;
  if (item.unit === "piece") return item.pack && item.pack > 0 ? price / item.pack : null;
  if (!(qty > 0)) return null;
  if (item.unit === "kg") {
    if (uom.includes("קילוגרם")) return price / qty;
    if (uom.includes("גרם")) return price / (qty / 1000);
    return null;
  }
  if (uom.includes("מיליליטר")) return price / (qty / 1000);
  if (uom.includes("ליטר")) return price / qty;
  return null;
}

/** One price per basket item for one store: the median of the unit prices of its matching barcodes. */
export function storePrices(items: ItemRecord[]): Map<string, number> {
  const per = new Map<BasketItem, number[]>();
  for (const r of items) {
    const b = CODE_TO_ITEM.get(r.code);
    if (!b) continue;
    const up = unitPrice(r, b);
    if (up === null || !Number.isFinite(up) || up <= 0) continue;
    (per.get(b) ?? per.set(b, []).get(b)!).push(up);
  }
  const out = new Map<string, number>();
  for (const [b, ps] of per) {
    const s = summarise(ps);
    if (s) out.set(itemKey(b.name, b.unit), s.median);
  }
  return out;
}

/** Library rows: national only, n = number of stores, 5 or more only. */
export function buildRows(stores: Map<string, number>[]): DailyRow[] {
  const recs = stores.flatMap((m) => [...m].map(([item, price]) => ({ area: NATIONAL, item, price })));
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

// ---------- collector ----------
const DEADLINE_MS = 8 * 60 * 1000; // the collector gives a source 10 minutes
const CONCURRENCY = 8;

async function getBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new SourceError(`Shufersal returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchStore(f: FileRef): Promise<Map<string, number> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const xml = gunzipSync(await getBuffer(f.url, 45000)).toString("utf8");
      const parsed = parseStoreFile(xml);
      if (parsed.chain && parsed.chain !== SHUFERSAL_CHAIN_ID) return null;
      return storePrices(parsed.items);
    } catch {
      /* try once more, then skip this store */
    }
  }
  return null;
}

async function fetchListingPage(page: number): Promise<ReturnType<typeof parseListing> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(LISTING_URL(page), { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new SourceError(`Shufersal returned HTTP ${res.status}`);
      return parseListing(await res.text());
    } catch (e) {
      if (page === 1 && attempt === 1) throw e;
    }
  }
  return null;
}

export async function shufersalHarvest(): Promise<HarvestResult> {
  const t0 = Date.now();
  // The file page is slow (about 18 s a page, 22 pages) and its download links last about 30 minutes, so read all pages first (in parallel), then the store files.
  const first = await fetchListingPage(1);
  if (!first) throw new SourceError("Shufersal's file page could not be read");
  const lists = [first];
  const rest = Array.from({ length: Math.min(first.pages, 60) - 1 }, (_, i) => i + 2);
  for (let i = 0; i < rest.length && Date.now() - t0 < DEADLINE_MS / 2; i += 8) {
    const got = await Promise.all(rest.slice(i, i + 8).map(fetchListingPage));
    for (const g of got) if (g) lists.push(g);
  }
  const seen = new Set<string>();
  const todo: FileRef[] = [];
  for (const l of lists) for (const f of l.files) {
    const k = `${f.sub}-${f.store}`;
    if (f.chain === SHUFERSAL_CHAIN_ID && !seen.has(k)) { seen.add(k); todo.push(f); }
  }
  const stores: Map<string, number>[] = [];
  let newest = "";
  let tried = 0;
  for (let i = 0; i < todo.length && Date.now() - t0 < DEADLINE_MS; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    tried += batch.length;
    const got = await Promise.all(batch.map(fetchStore));
    got.forEach((g, j) => {
      if (g && g.size) { stores.push(g); if (batch[j].date > newest) newest = batch[j].date; }
    });
  }
  if (stores.length < 20) throw new SourceError(`Only ${stores.length} of ${tried} Shufersal store files could be read (${todo.length} listed; expected about 400)`);
  const rows = buildRows(stores);
  if (rows.length < 8) throw new SourceError(`Only ${rows.length} basket items reached 5 stores (expected about ${BASKET.length})`);
  return {
    date: newest || new Date().toISOString().slice(0, 10),
    currency: "ILS",
    unit: "per kg, per litre or per piece (named in the item)",
    rows,
    note: `${stores.length} of ${todo.length} listed Shufersal store files read, ${rows.length} of ${BASKET.length} basket items with 5+ stores.`,
  };
}

// ---------- matching ----------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "in", "israel", "shufersal", "how", "much", "is", "for", "and", "pack", "fat"]);
const SYNONYMS: Record<string, string> = { egg: "eggs", eggs: "eggs", cheese: "cheese", cottage: "cottage", whole: "wholemeal", wholewheat: "wholemeal", tomato: "tomatoes", cucumber: "cucumbers", potato: "potatoes", banana: "bananas" };

export interface Def { name: string; unit: Unit; row: DailyRow }

export function matchItems(defs: Def[], query: string): Def[] {
  const full = norm(query).split(" ").filter(Boolean);
  const words = full.filter((w) => !STOP.has(w)).map((w) => stem(SYNONYMS[w] ?? w));
  const qs = words.length ? words : full.map(stem);
  if (!qs.length) return [];
  return defs
    .map((d) => {
      const nw = norm(d.name).split(" ").map(stem);
      const hit = qs.every((w) => nw.includes(w));
      const exact = hit && norm(d.name).split(" ").filter((w) => !STOP.has(w)).length === qs.length ? 1 : 0;
      return { d, hit, exact };
    })
    .filter((x) => x.hit)
    .sort((a, b) => b.exact - a.exact || b.d.row.n - a.d.row.n || a.d.name.localeCompare(b.d.name))
    .map((x) => x.d);
}

export function defsFromRows(rows: DailyRow[]): Def[] {
  const out: Def[] = [];
  for (const r of rows) {
    if (r.area !== NATIONAL || r.n < MIN_PUBLISH) continue;
    const [name, unit] = r.item.split("|");
    if (name && (unit === "kg" || unit === "L" || unit === "piece")) out.push({ name, unit, row: r });
  }
  return out;
}

const METHOD =
  "Israel (posted supermarket shelf prices, one chain): Shufersal publishes every store's full price list daily under Israel's price-transparency rules; ProofPrice reads each store's file, picks a fixed basket of everyday products by barcode, " +
  "converts each to a price per kg, per litre or per piece (one price per store), and reports the median and 10th–90th percentile across stores, in shekels. Posted prices of one chain, not receipts; n is the number of stores (5 or more needed).";

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);

export function answerFromRows(day: { date: string; rows: DailyRow[] }, input: { item?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'eggs', 'bread', 'rice', 'flour', 'oil', 'tomatoes', 'chicken', 'cottage cheese' or 'butter'.");
  const defs = defsFromRows(day.rows);
  const hits = matchItems(defs, /oil/i.test(item) && !/(canola|sunflower)/i.test(item) ? item.replace(/oil/i, "canola oil") : item);
  if (!hits.length) {
    const names = [...new Set(defs.map((d) => d.name))].sort();
    return buildAnswer({
      source: INFO, query: { country: "IL", item }, summary: null, currency: "ILS", unit: "per kg",
      period: { from: day.date, to: day.date }, method: METHOD, describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: `No basket item matching '${item}' has 5 or more store prices. Items held: ${names.join("; ")}.` },
    });
  }
  const best = hits[0], r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${unitLabel(d.unit)}`);
  return buildAnswer({
    source: INFO,
    query: { country: "IL", item: `${best.name}, ${unitLabel(best.unit)}` },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "ILS",
    unit: unitLabel(best.unit),
    period: { from: day.date, to: day.date },
    method: METHOD,
    describe: (x) =>
      `Shufersal's published shelf prices put ${best.name} ${unitLabel(best.unit)} at a median of ${fmtMoney(x.median, "ILS")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "ILS")}–${fmtMoney(x.high, "ILS")} across ${r.n} stores. Posted prices of one chain, not receipts; files dated ${day.date}.` +
      (stale ? ` The files are ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: { store_prices: r.n, chain: "Shufersal", ...(others.length ? { other_definitions: others } : {}), ...(stale ? { stale_source: true, days_since_updated: ageDays } : {}) },
  });
}

export async function shufersalPrices(input: { item?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) {
    if (!(input.item ?? "").trim()) throw new InputError("item is required: an everyday item such as 'milk', 'eggs', 'bread' or 'rice'.");
    throw new SourceError("ProofPrice collects Shufersal's price files daily; data appears after the next collection.");
  }
  const day = readLatestDay(INFO.id);
  if (!day || day.rows.length < 5) throw new SourceError("ProofPrice collects Shufersal's price files daily; data appears after the next collection.");
  return answerFromRows(day, input);
}

export function shufersalHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  if (!p.item) return null;
  const defs: Def[] = BASKET.map((b) => ({ name: b.name, unit: b.unit, row: { area: NATIONAL, item: "", n: 99, median: 0, low: 0, high: 0, min: 0, max: 0 } }));
  const best = matchItems(defs, p.item)[0];
  return best ? { area: NATIONAL, item: itemKey(best.name, best.unit), label: `${best.name} ${unitLabel(best.unit)}, Israel (Shufersal)` } : null;
}
