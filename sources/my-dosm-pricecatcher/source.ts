// Malaysia PriceCatcher (DOSM, open.dosm.gov.my): shelf prices of everyday goods recorded by DOSM field staff in shops and markets,
// one row per premise, item and day. The monthly file is about 11 MB, so we never read it per request: the daily collector (harvest)
// downloads the newest monthly file and the two small lookup files, keeps each shop's newest price per item over the last 7 days,
// and stores one aggregate per state and item (the staples plus the items priced in most shops) in the price library. Requests are answered from there.
// POSTED shelf prices (not receipts, not what one shopper paid), in Malaysian ringgit.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "my-dosm-pricecatcher",
  country: "Malaysia",
  category: "groceries (shop shelf prices of everyday goods)",
  name: "PriceCatcher (Department of Statistics Malaysia)",
  publisher: "Department of Statistics Malaysia (DOSM), via open.dosm.gov.my",
  what_is_recorded:
    "The shelf price of one everyday item (fresh food, dry goods, packaged food, drinks, household items) in one shop or market on one day, recorded by DOSM staff, in Malaysian ringgit.",
  price_type: "posted_price",
  freshness: "DOSM refreshes the monthly file daily; our copy is refreshed daily and each answer names the newest price date",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Department of Statistics Malaysia (DOSM), PriceCatcher, open.dosm.gov.my, CC BY 4.0. Changed by ProofPrice: for each item we take every shop's newest price over 7 days and report the median and 10th to 90th percentile across shops, by state.",
  homepage: "https://open.dosm.gov.my/data-catalogue/pricecatcher",
  limits:
    "Posted shelf prices that DOSM staff recorded, not receipts and not what one shopper paid; DOSM warns the sample is not representative and is not the consumer price index. " +
    "Item names are in Malay; ProofPrice matches common English words with a small word list. Only the main staples (a few items per food category) and the other items priced in the most shops are kept, a state needs 5 or more shops for an item, " +
    "and prices more than 5 times above or below the item's national median are dropped as entry errors.",
};

export const BASE = "https://storage.data.gov.my/pricecatcher";
export const ITEM_URL = `${BASE}/lookup_item.csv`;
export const PREMISE_URL = `${BASE}/lookup_premise.csv`;
export const monthUrl = (ym: string) => `${BASE}/pricecatcher_${ym}.csv`;
export const WINDOW_DAYS = 7; // a shop counts when its newest price for the item is within this many days of the file's newest day
export const KEEP_OTHER = 40; // besides the staples, this many more items priced in the most shops go into the library
/** Staple categories (DOSM item_category): the few items priced in most shops in each are always kept; the number is how many. */
export const STAPLE_CATEGORIES: Record<string, number> = {
  AYAM: 3, DAGING: 3, TELUR: 3, BERAS: 3, "MINYAK DAN LEMAK": 3, TEPUNG: 2, ROTI: 2, "BAHAN LAUT": 4, "IKAN DARAT": 2, "BUAH-BUAHAN": 5, "SAYUR-SAYURAN": 6,
  BAWANG: 2, "UBI KENTANG": 2, "TERSEDIA MINUM": 3, "KRIMER DAN SUSU TEPUNG": 2, GULA: 2, GARAM: 1,
};
export const STAPLE_NAME = /^(GULA|GARAM|SUSU SEGAR)\b/;
export const OUTLIER_FACTOR = 5;
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

function eachLine(text: string, fn: (line: string) => void): void {
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, "");
    pos = end + 1;
    if (line) fn(line);
  }
}

function header(text: string, required: string[], what: string): { idx: Record<string, number>; body: string } {
  const nl = text.indexOf("\n");
  if (nl < 0) throw new SourceError(`${what} is empty`);
  const head = splitLine(text.slice(0, nl).replace(/^﻿/, "").trim()).map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const k of required) {
    idx[k] = head.indexOf(k);
    if (idx[k] < 0) throw new SourceError(`${what} has a new layout: column ${k} is missing`);
  }
  return { idx, body: text.slice(nl + 1) };
}

export interface ItemDef { code: number; name: string; unit: string; category: string }

/** Item key stored in the library: "AYAM BERSIH - STANDARD|1kg". Commas become "/" and pipes are removed, so the key is one CSV cell. */
export function itemKey(name: string, unit: string): string {
  return `${name.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, "/").replace(/\|/g, " ")}|${unit.trim()}`;
}

export function parseItems(text: string): Map<number, ItemDef> {
  const { idx, body } = header(text, ["item_code", "item", "unit", "item_category"], "PriceCatcher item lookup");
  const out = new Map<number, ItemDef>();
  eachLine(body, (line) => {
    const c = splitLine(line);
    const code = Number(c[idx.item_code]);
    const name = (c[idx.item] ?? "").trim(), unit = (c[idx.unit] ?? "").trim();
    if (!Number.isInteger(code) || code <= 0 || !name || !unit) return; // -1 is a placeholder row
    out.set(code, { code, name, unit, category: (c[idx.item_category] ?? "").trim().toUpperCase() });
  });
  return out;
}

/** premise_code -> state. Addresses and shop names are never read or kept. */
export function parsePremises(text: string): Map<number, string> {
  const { idx, body } = header(text, ["premise_code", "state"], "PriceCatcher premise lookup");
  const out = new Map<number, string>();
  eachLine(body, (line) => {
    const c = splitLine(line);
    const code = Number(c[idx.premise_code]);
    const state = (c[idx.state] ?? "").trim();
    if (!Number.isInteger(code) || code <= 0 || !state) return;
    out.set(code, state);
  });
  return out;
}

export interface Seen { date: string; price: number }

/** Reads one monthly price file and keeps, for every shop and item, the newest price. Returns the newest day in the file. */
export class Newest {
  private map = new Map<number, Seen>(); // key = premise * 100000 + item
  newestDate = "";
  rows = 0;
  add(premise: number, item: number, date: string, price: number): void {
    this.rows++;
    if (date > this.newestDate) this.newestDate = date;
    const k = premise * 100000 + item;
    const cur = this.map.get(k);
    if (!cur || date > cur.date) this.map.set(k, { date, price });
  }
  get size(): number { return this.map.size; }
  entries(): { premise: number; item: number; date: string; price: number }[] {
    return [...this.map].map(([k, v]) => ({ premise: Math.floor(k / 100000), item: k % 100000, ...v }));
  }
}

export function parsePrices(text: string, into: Newest): { rows: number; kept: number } {
  const { idx, body } = header(text, ["date", "premise_code", "item_code", "price"], "PriceCatcher price file");
  let rows = 0, kept = 0;
  eachLine(body, (line) => {
    rows++;
    const c = line.split(",");
    const premise = Number(c[idx.premise_code]), item = Number(c[idx.item_code]), price = Number(c[idx.price]);
    const date = (c[idx.date] ?? "").trim();
    if (!(premise > 0) || !(item > 0) || !(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    into.add(premise, item, date, price);
    kept++;
  });
  return { rows, kept };
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export interface Built { rows: DailyRow[]; date: string | null; items: number; states: string[]; dropped: { outliers: number; noState: number } }

/** Library rows for the newest day: area = state (or ALL), item = "<name>|<unit>"; n = shops. Keeps the staples (STAPLE_CATEGORIES, best-covered items first) plus the KEEP_OTHER other items priced in most shops. */
export function buildRows(entries: ReturnType<Newest["entries"]>, items: Map<number, ItemDef>, premises: Map<number, string>, newestDate: string): Built {
  if (!newestDate) return { rows: [], date: null, items: 0, states: [], dropped: { outliers: 0, noState: 0 } };
  const cutoff = dayNumber(newestDate) - (WINDOW_DAYS - 1);
  let noState = 0;
  const recent = entries.filter((e) => dayNumber(e.date) >= cutoff && items.has(e.item));
  const perItem = new Map<number, number[]>();
  for (const e of recent) {
    if (!premises.has(e.premise)) { noState++; continue; }
    const a = perItem.get(e.item);
    if (a) a.push(e.price); else perItem.set(e.item, [e.price]);
  }
  const ranked = [...perItem].filter(([, p]) => p.length >= MIN_PUBLISH).sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const used = new Map<string, number>();
  const top: [number, number[]][] = [];
  const rest: [number, number[]][] = [];
  for (const e of ranked) {
    const d = items.get(e[0])!;
    const bucket = STAPLE_NAME.test(d.name) ? "NAME:" + d.name.split(" ")[0] : d.category;
    const cap = STAPLE_NAME.test(d.name) ? 2 : STAPLE_CATEGORIES[d.category];
    if (cap !== undefined && (used.get(bucket) ?? 0) < cap) { used.set(bucket, (used.get(bucket) ?? 0) + 1); top.push(e); }
    else rest.push(e);
  }
  top.push(...rest.slice(0, KEEP_OTHER));
  const medians = new Map<number, number>();
  for (const [code, prices] of top) {
    const s = [...prices].sort((a, b) => a - b);
    medians.set(code, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  let outliers = 0;
  const recs: { area: string; item: string; price: number }[] = [];
  for (const e of recent) {
    const med = medians.get(e.item);
    const state = premises.get(e.premise);
    if (med === undefined || !state) continue;
    if (e.price > med * OUTLIER_FACTOR || e.price < med / OUTLIER_FACTOR) { outliers++; continue; }
    const d = items.get(e.item)!;
    recs.push({ area: state, item: itemKey(d.name, d.unit), price: e.price });
  }
  const rows = aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH);
  const states = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  return { rows, date: newestDate, items: new Set(rows.map((r) => r.item)).size, states, dropped: { outliers, noState } };
}

async function getText(url: string, allow404 = false): Promise<string | null> {
  const res = await fetch(url, { headers: UA });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new SourceError(`PriceCatcher returned HTTP ${res.status} for ${url.split("/").pop()}`);
  return new TextDecoder("utf-8").decode(Buffer.from(await res.arrayBuffer()));
}

export async function pricecatcherHarvest(): Promise<HarvestResult> {
  const now = new Date();
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [itemText, premiseText] = await Promise.all([getText(ITEM_URL), getText(PREMISE_URL)]);
  const items = parseItems(itemText!), premises = parsePremises(premiseText!);
  if (!items.size || !premises.size) throw new SourceError("PriceCatcher lookup files held no items or premises");
  const newest = new Newest();
  let read = 0, kept = 0;
  const cur = await getText(monthUrl(ym(now)), true);
  if (cur) { const r = parsePrices(cur, newest); read += r.rows; kept += r.kept; }
  // early in a month the file holds fewer than 7 days: add the previous month so the 7-day window is full
  if (!cur || (newest.newestDate && Number(newest.newestDate.slice(8, 10)) < WINDOW_DAYS)) {
    const p = await getText(monthUrl(ym(prev)), true);
    if (p) { const r = parsePrices(p, newest); read += r.rows; kept += r.kept; }
  }
  const built = buildRows(newest.entries(), items, premises, newest.newestDate);
  if (!built.rows.length || !built.date) throw new SourceError(`PriceCatcher files held no usable prices (${read} rows read, ${kept} kept)`);
  return {
    date: built.date,
    currency: "MYR",
    unit: "per unit named in the item",
    rows: built.rows,
    note: `${read} rows read, ${kept} kept; newest day ${built.date}; ${built.items} items, ${built.states.length} states; ${built.dropped.outliers} outlier prices dropped; ${built.dropped.noState} prices at shops with no state.`,
  };
}

// ---------- English matching ----------
// Item names are Malay. A small word list lets people ask in English; the answer always shows the DOSM item name.
export const GLOSS: Record<string, string> = {
  ayam: "chicken", daging: "meat beef", kambing: "mutton lamb goat", bebiri: "mutton lamb", kerbau: "buffalo beef", lembu: "beef cow", itik: "duck", puyuh: "quail",
  telur: "egg eggs", susu: "milk", segar: "fresh", tepung: "powder flour", gandum: "wheat flour", beras: "rice", gula: "sugar", garam: "salt", minyak: "oil",
  masak: "cooking", jagung: "corn", sapi: "ghee", roti: "bread", kicap: "soy sauce", sos: "sauce", krimer: "creamer", teh: "tea", kopi: "coffee", jus: "juice",
  kordial: "cordial squash", ikan: "fish", bilis: "anchovies anchovy", sotong: "squid", ketam: "crab", udang: "prawn shrimp", bawal: "pomfret", kembung: "mackerel", tenggiri: "mackerel",
  cili: "chilli chili", halia: "ginger", kunyit: "turmeric", kacang: "beans nuts peanut", bendi: "okra ladies fingers", buncis: "green beans", panjang: "long", hijau: "green mung",
  kelapa: "coconut", santan: "coconut milk", kubis: "cabbage", lobak: "carrot", merah: "red", terung: "eggplant aubergine brinjal", timun: "cucumber", tomato: "tomato",
  bawang: "onion", besar: "big large", kecil: "small shallot", kentang: "potato", ubi: "potato tuber", betik: "papaya", pisang: "banana", tembikai: "watermelon",
  nenas: "pineapple", anggur: "grape grapes", jambu: "guava", oren: "orange", epal: "apple", lada: "pepper", hitam: "black", putih: "white", serbuk: "powder",
  rempah: "spice spices", mee: "noodles", mi: "noodles", bihun: "vermicelli noodles", marjerin: "margarine", mentega: "butter", sardin: "sardine sardines", coklat: "chocolate",
  sabun: "soap", sampo: "shampoo", ubat: "medicine", gigi: "tooth teeth toothpaste", biji: "piece", bayi: "baby", impor: "imported", import: "imported", tempatan: "local",
};
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w);
const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "per", "kg", "in", "malaysia", "how", "much", "is", "for", "retail"]);
const QUERY_SYNONYMS: Record<string, string> = { chilies: "chilli", chillies: "chilli", cooking_oil: "oil" };

export interface Def { key: string; name: string; unit: string; n: number; row: DailyRow }

export function parseKey(key: string): { name: string; unit: string } | null {
  const p = key.split("|");
  return p.length === 2 ? { name: p[0], unit: p[1] } : null;
}

function wordsOf(name: string): { malay: string[]; english: Set<string> } {
  const malay = norm(name).split(" ").filter(Boolean);
  const english = new Set<string>();
  const melon = malay.includes("tembikai"); // "TEMBIKAI SUSU" is a kind of watermelon, not milk
  for (const w of malay) {
    english.add(stem(w));
    const g = melon && w === "susu" ? undefined : GLOSS[w];
    if (g) for (const e of g.split(" ")) english.add(stem(e));
  }
  return { malay, english };
}

/** Items matching a question in English or Malay, best first: every query word must be a word of the name or its English gloss; shorter names (more generic) rank higher. */
export function matchItems(defs: Def[], query: string): Def[] {
  const words = norm(query).split(" ").filter((w) => w && !STOP.has(w)).map((w) => stem(QUERY_SYNONYMS[w] ?? w));
  if (!words.length) return [];
  const scored: { d: Def; s: number }[] = [];
  for (const d of defs) {
    const { malay, english } = wordsOf(d.name);
    if (!words.every((w) => english.has(w))) continue;
    scored.push({ d, s: 100 - 4 * Math.max(0, malay.length - words.length) });
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
  kl: "kuala lumpur", penang: "pulau pinang", "negri sembilan": "negeri sembilan", putrajaya: "putrajaya", labuan: "labuan", malacca: "melaka",
};

/** The library's state name for what the caller typed, or null. "Kuala Lumpur" matches "W.P. Kuala Lumpur". */
export function resolveState(rows: DailyRow[], region: string): string | null {
  const states = [...new Set(rows.map((r) => r.area))].filter((a) => a !== NATIONAL);
  const q0 = norm(region);
  const q = STATE_ALIASES[q0] ?? q0;
  if (!q) return null;
  const strip = (s: string) => norm(s).replace(/^wp /, "").replace(/^w p /, "");
  return states.find((s) => strip(s) === q) ?? states.find((s) => strip(s).includes(q)) ?? null;
}

function methodText() {
  return (
    "Median and 10th–90th percentile, across shops and markets, of each shop's newest price for the item in DOSM's PriceCatcher survey over the last 7 days of data, in Malaysian ringgit. " +
    "Posted shelf prices recorded by DOSM staff, not receipts; n is the number of shops (5 or more needed)."
  );
}

export interface LibraryDay { date: string; rows: DailyRow[] }

export function pricecatcherAnswerFromRows(day: LibraryDay, input: { item?: string; region?: string; baseUrl?: string; today?: string }): PriceAnswer {
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: an everyday item in plain words such as 'chicken', 'eggs', 'rice', 'cooking oil', 'sugar' or 'milk'.");
  const region = (input.region ?? "").trim();
  let area = NATIONAL;
  let stateName = "Malaysia";
  if (region) {
    const st = resolveState(day.rows, region);
    if (!st) {
      const states = [...new Set(day.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
      throw new InputError(`region '${region}' has no figures in our copy (no item priced in 5 or more shops there, or not a Malaysian state). States with figures: ${states.join(", ")}. Leave region out for the national figure.`);
    }
    area = st;
    stateName = st;
  }
  const from = isoOf(dayNumber(day.date) - (WINDOW_DAYS - 1));
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country: "MY", item, ...(region ? { region } : {}) }, summary: null, currency: "MYR", unit: "per unit",
      period: { from, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  const defs = defsFor(day.rows, area);
  const hits = matchItems(defs, item);
  if (!hits.length) {
    const all = matchItems(defsFor(day.rows, NATIONAL), item);
    const names = [...new Set(defsFor(day.rows, NATIONAL).map((d) => d.name))].sort().slice(0, 30);
    return empty(
      area !== NATIONAL && all.length
        ? `Fewer than 5 shops in ${stateName} priced '${item}' in the last 7 days of data. Leave region out for the national figure.`
        : `No item matching '${item}' is priced in 5 or more shops in our copy. Items held include: ${names.join("; ")}.`,
    );
  }
  const best = hits[0];
  const r = best.row;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const others = hits.slice(1, 9).map((d) => `${d.name}, per ${d.unit}`);
  return buildAnswer({
    source: INFO,
    query: { country: "MY", item: `${best.name}, per ${best.unit}`, ...(region ? { region: stateName } : {}) },
    summary: { count: r.n, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max },
    currency: "MYR",
    unit: `per ${best.unit}`,
    period: { from, to: day.date },
    method: methodText(),
    describe: (x) =>
      `DOSM PriceCatcher shelf prices in ${stateName} put ${best.name} (per ${best.unit}) at a median of ${fmtMoney(x.median, "MYR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "MYR")}–${fmtMoney(x.high, "MYR")} across shops. ` +
      `These are posted shelf prices recorded by DOSM staff, not receipts; newest prices are from ${day.date}.` +
      (stale ? ` Our copy was collected ${ageDays} days ago.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      shops: r.n,
      area: stateName,
      ...(others.length ? { other_definitions: others } : {}),
      ...(stale ? { stale: true, days_since_collected: ageDays } : {}),
    },
  });
}

export async function pricecatcherPrices(input: { item?: string; region?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the Malaysian PriceCatcher file daily; data appears after the next collection.");
  return pricecatcherAnswerFromRows(day, input);
}

export function pricecatcherHistoryKey(p: { item?: string; region?: string }): { area: string; item: string; label: string } | null {
  try {
    const day = readLatestDay(INFO.id);
    if (!day || !p.item) return null;
    const area = p.region ? resolveState(day.rows, String(p.region)) : NATIONAL;
    if (!area) return null;
    const best = matchItems(defsFor(day.rows, area), String(p.item))[0];
    return best ? { area, item: best.key, label: `${best.name}, ${area === NATIONAL ? "Malaysia" : area}` } : null;
  } catch {
    return null;
  }
}
