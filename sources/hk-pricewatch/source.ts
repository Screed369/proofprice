// Hong Kong Online Price Watch (Consumer Council, via DATA.GOV.HK): the shelf price of each supermarket product in each chain, rebuilt daily.
// The feed (about 2.7 MB JSON) only holds today's snapshot, so the daily collector (harvest) reads it once a day, turns every product x chain price
// into a record (unit price per kg or per litre where the pack size is in the name, otherwise per pack) and stores one aggregate per product
// category and chain in the price library. Requests are answered from there. POSTED shelf prices (not receipts), in Hong Kong dollars.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "hk-pricewatch",
  country: "Hong Kong",
  category: "groceries (supermarket shelf prices)",
  name: "Online Price Watch (Consumer Council)",
  publisher: "Consumer Council of Hong Kong, via DATA.GOV.HK",
  what_is_recorded:
    "The shelf price of a supermarket product (food, drink and household goods) in one Hong Kong supermarket chain on one day, in Hong Kong dollars, as published by the Consumer Council's Online Price Watch.",
  price_type: "posted_price",
  freshness: "Daily",
  licence: "DATA.GOV.HK Terms and Conditions of Use (free re-use, commercial and non-commercial, with credit to the data provider)",
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution:
    "Source: Consumer Council of Hong Kong, Online Price Watch, via DATA.GOV.HK (https://data.gov.hk/en-data/dataset/cc-pricewatch-pricewatch), under the DATA.GOV.HK Terms and Conditions of Use. " +
    "Changed by ProofPrice: we group the product prices by category and report the median and 10th to 90th percentile.",
  homepage: "https://data.gov.hk/en-data/dataset/cc-pricewatch-pricewatch",
  limits:
    "Posted shelf prices that the supermarkets report to the Consumer Council, not receipts and not what one shopper paid; special offers (buy 3 for $30) are not in the price. " +
    "Products differ in brand and pack size inside a category, so the range is a spread over products, not one like-for-like item; where the pack size is in the product name we convert to a price per kg or per litre, otherwise the unit is per pack. " +
    "A figure needs 5 or more shelf prices. The feed covers the large supermarket chains only, not wet markets or convenience stores.",
};

export const FEED_URL = "https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json";
export const KEEP_ITEMS = 220; // the categories with the most shelf prices go into the library
export const STALE_AFTER_DAYS = 7;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export const CHAINS: Record<string, string> = {
  WELLCOME: "Wellcome",
  PARKNSHOP: "ParknShop",
  JASONS: "Jasons",
  AEON: "AEON",
  DCHFOOD: "DCH Food Mart",
  LUNGFUNG: "Lung Fung",
};
export const chainName = (code: string): string =>
  CHAINS[code.toUpperCase()] ?? code.toLowerCase().replace(/(^|[ _-])(\w)/g, (_m, a, b) => a + b.toUpperCase()).replace(/[:|,]/g, " ").trim();

export interface Product { code: string; name: string; cat2: string; cat3: string; prices: { chain: string; price: number }[] }

const en = (x: any): string => (x && typeof x === "object" ? String(x.en ?? "") : String(x ?? "")).replace(/\s+/g, " ").trim();

/** The feed: a JSON array of products. Rows without a category or any price are skipped. */
export function parseFeed(text: string): Product[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new SourceError("Online Price Watch did not return JSON"); }
  if (!Array.isArray(data)) throw new SourceError("Online Price Watch has a new layout: the file is not a list of products");
  const out: Product[] = [];
  for (const p of data as any[]) {
    if (!p || !Array.isArray(p.prices)) continue;
    const prices: Product["prices"] = [];
    for (const x of p.prices) {
      const price = Number(x?.price);
      const chain = String(x?.supermarketCode ?? "").trim();
      if (chain && Number.isFinite(price) && price > 0) prices.push({ chain: chainName(chain), price });
    }
    const cat2 = en(p.cat2Name), cat3 = en(p.cat3Name);
    if (!prices.length || (!cat2 && !cat3)) continue;
    out.push({ code: String(p.code ?? ""), name: en(p.name), cat2, cat3, prices });
  }
  return out;
}

export type Unit = "kg" | "L" | "pack";

/** Pack size from a product name: "250g", "510 gm", "946mL", "1.5L", "6 x 250ml", "330ml x 6". Returns grams or millilitres, or null. */
export function packSize(name: string): { kind: "kg" | "L"; amount: number } | null {
  const re = /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|gm|g|ml|l|litre|liter)s?\b(?:\s*[x×]\s*(\d+))?/gi;
  let last: RegExpExecArray | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(name))) last = m;
  if (!last) return null;
  const mult = Number(last[1] ?? last[4] ?? 1) || 1;
  const n = Number(last[2]);
  const u = last[3].toLowerCase();
  if (!(n > 0) || mult > 48) return null;
  if (u === "kg") return { kind: "kg", amount: n * mult };
  if (u === "g" || u === "gm") return { kind: "kg", amount: (n * mult) / 1000 };
  if (u === "ml") return { kind: "L", amount: (n * mult) / 1000 };
  return { kind: "L", amount: n * mult };
}

/** A pack under 20 g or 20 ml, or over 50 kg or 50 l, is a typo or a different kind of product: priced per pack instead. */
function unitPrice(name: string, price: number): { unit: Unit; price: number } {
  const s = packSize(name);
  if (!s || s.amount < 0.02 || s.amount > 50) return { unit: "pack", price };
  return { unit: s.kind, price: price / s.amount };
}

/** Library item key: "<category>|<unit>". No commas, pipes or colons inside the category. */
export function itemKey(category: string, unit: Unit): string {
  return `${category.replace(/\s*,\s*/g, "/").replace(/[|:]/g, " ").replace(/\s+/g, " ").trim()}|${unit}`;
}

export interface Built { rows: DailyRow[]; products: number; prices: number; items: number; chains: string[] }

/** Library rows: area = chain (or ALL), item = "<category>|<unit>", n = shelf prices. A product counts in its sub-category (cat3) and its category (cat2).
 *  Only the KEEP_ITEMS best-covered items are kept, and only rows with 5 or more shelf prices. */
export function buildRows(products: Product[]): Built {
  const recs: { area: string; item: string; price: number }[] = [];
  let prices = 0;
  for (const p of products) {
    const cats = [...new Set([p.cat3, p.cat2].filter(Boolean))];
    for (const x of p.prices) {
      prices++;
      const u = unitPrice(p.name, x.price);
      for (const c of cats) recs.push({ area: x.chain, item: itemKey(c, u.unit), price: u.price });
    }
  }
  const all = aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH);
  const national = all.filter((r) => r.area === NATIONAL).sort((a, b) => b.n - a.n || a.item.localeCompare(b.item));
  const keep = new Set(national.slice(0, KEEP_ITEMS).map((r) => r.item));
  const rows = all.filter((r) => keep.has(r.item));
  const chains = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  return { rows, products: products.length, prices, items: keep.size, chains };
}

/** The date the feed describes: the Last-Modified day, else today (UTC). */
export function feedDate(lastModified: string | null, now = new Date()): string {
  const t = lastModified ? Date.parse(lastModified) : NaN;
  return (Number.isFinite(t) ? new Date(t) : now).toISOString().slice(0, 10);
}

export async function pricewatchHarvest(): Promise<HarvestResult> {
  const res = await fetch(FEED_URL, { headers: UA });
  if (!res.ok) throw new SourceError(`Online Price Watch returned HTTP ${res.status}`);
  const text = new TextDecoder("utf-8").decode(Buffer.from(await res.arrayBuffer()));
  const products = parseFeed(text);
  if (products.length < 100) throw new SourceError(`Online Price Watch held only ${products.length} priced products (expected thousands)`);
  const built = buildRows(products);
  if (!built.rows.length) throw new SourceError("Online Price Watch held no category with 5 or more shelf prices");
  const date = feedDate(res.headers.get("last-modified"));
  return {
    date,
    currency: "HKD",
    unit: "per kg, per litre or per pack (named in the item)",
    rows: built.rows,
    note: `${built.products} products, ${built.prices} shelf prices; ${built.items} categories kept, ${built.chains.length} chains (${built.chains.join(", ")}).`,
  };
}

// ---------- matching ----------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "in", "hong", "kong", "hk", "how", "much", "is", "for", "retail", "supermarket", "and"]);
const QUERY_SYNONYMS: Record<string, string> = { bread: "bread", yoghurt: "yogurt", chilies: "chilli", chillies: "chilli", coke: "cola", soda: "soft", nappies: "diaper", nappy: "diaper" };

export interface Def { key: string; name: string; unit: Unit; n: number; row: DailyRow }

export function parseKey(key: string): { name: string; unit: Unit } | null {
  const p = key.split("|");
  return p.length === 2 && (p[1] === "kg" || p[1] === "L" || p[1] === "pack") ? { name: p[0], unit: p[1] as Unit } : null;
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

/** Categories matching a question, best first: every query word must be a word of the category name. A shorter (more generic) name ranks higher, then the larger sample;
 *  for one category the unit with most shelf prices wins. */
export function matchItems(defs: Def[], query: string): Def[] {
  const words = norm(query).split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(QUERY_SYNONYMS[w] ?? w));
  if (!words.length) return [];
  const scored: { d: Def; s: number }[] = [];
  for (const d of defs) {
    const nameWords = norm(d.name).split(" ").filter(Boolean).map(stem);
    if (!words.every((w) => nameWords.includes(w))) continue;
    const exact = nameWords.length === words.length ? 20 : 0;
    scored.push({ d, s: 100 + exact - 4 * Math.max(0, nameWords.length - words.length) });
  }
  const ranked = scored.sort((a, b) => b.s - a.s || b.d.n - a.d.n || a.d.key.localeCompare(b.d.key)).map((x) => x.d);
  const seen = new Set<string>();
  return ranked.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
}

/** The library's chain name for what the caller typed ("parknshop", "Park n Shop", "wellcome"), or null. */
export function resolveChain(rows: DailyRow[], region: string): string | null {
  const chains = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q = norm(region).replace(/ /g, "");
  if (!q) return null;
  const flat = (s: string) => norm(s).replace(/ /g, "");
  return chains.find((c) => flat(c) === q) ?? chains.find((c) => flat(c).includes(q) || (q.length >= 4 && q.includes(flat(c)))) ?? null;
}

const unitLabel = (u: Unit) => (u === "kg" ? "per kg" : u === "L" ? "per litre" : "per pack (sizes vary)");

function methodText() {
  return (
    "Median and 10th–90th percentile of the shelf prices of the products in a category in the Consumer Council's Online Price Watch, one price per product and supermarket chain, in Hong Kong dollars; " +
    "per kg or per litre where the pack size is in the product name, otherwise per pack. Posted shelf prices, not receipts; n is the number of shelf prices (5 or more needed)."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }
const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);

export function pricewatchAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: a grocery category in plain words such as 'milk', 'eggs', 'rice', 'bread', 'honey' or 'instant noodles'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let where = "Hong Kong supermarkets";
  if (region) {
    const c = resolveChain(day.rows, region);
    if (!c) {
      const chains = [...new Set(day.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' is not a supermarket chain with figures in our copy. Chains with figures: ${chains.join(", ")}. Leave region out for all chains together.`);
    }
    area = c;
    where = c;
  }
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country: "HK", item, ...(region ? { region } : {}) }, summary: null, currency: "HKD", unit: "per pack",
      period: { from: day.date, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  const hits = matchItems(defsFor(day.rows, area), item);
  if (!hits.length) {
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.name))].sort().slice(0, 40);
    const wider = area !== NATIONAL && matchItems(defsFor(day.rows, NATIONAL), item).length > 0;
    return empty(
      wider
        ? `Fewer than 5 shelf prices for '${item}' at ${where}. Leave region out for all chains together.`
        : `No category matching '${item}' has 5 or more shelf prices in our copy. Categories held include: ${names.join("; ")}.`,
    );
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, ${unitLabel(d.unit)}`);
  const byChain = area === NATIONAL
    ? day.rows.filter((x) => x.item === best.key && x.area !== NATIONAL && x.n >= MIN_PUBLISH).map((x) => ({ chain: x.area, median: x.median, shelf_prices: x.n }))
    : [];
  return buildAnswer({
    source: INFO,
    query: { country: "HK", item: `${best.name}, ${unitLabel(best.unit)}`, ...(region ? { region: where } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "HKD",
    unit: unitLabel(best.unit),
    period: { from: day.date, to: day.date },
    method: methodText(),
    describe: (x) =>
      `Consumer Council Online Price Watch shelf prices at ${where} put ${best.name} ${unitLabel(best.unit)} at a median of ${fmtMoney(x.median, "HKD")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "HKD")}–${fmtMoney(x.high, "HKD")} across ${r.n} product prices. ` +
      `These are posted shelf prices (brands and pack sizes differ), not receipts; prices are from ${day.date}.` +
      (stale ? ` Our copy was collected ${ageDays} days ago.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      shelf_prices: r.n,
      area: where,
      ...(byChain.length ? { by_chain: byChain } : {}),
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { stale: true, days_since_collected: ageDays } : {}),
    },
  });
}

export async function pricewatchPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Hong Kong Online Price Watch file daily; data appears after the next collection.");
  return pricewatchAnswerFromRows(day, input);
}

export function pricewatchHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveChain(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name} ${unitLabel(best.unit)}, ${area === NATIONAL ? "Hong Kong" : area}` } : null;
  } catch {
    return null;
  }
}
