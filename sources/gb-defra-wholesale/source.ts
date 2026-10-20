// GB wholesale fruit and vegetables: DEFRA "Wholesale fruit and vegetable prices, weekly average" (England and Wales, home-grown produce).
// Format checked 2026-10-20 from GitHub's servers (probe): the gov.uk content API
//   GET https://www.gov.uk/api/content/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average
// = 200 JSON; details.attachments[] holds three files, the CSV is the one with content_type "text/csv" (851,866 bytes, key-free).
// The media hash and the date suffix in the CSV URL change with every release, so the URL is read from the API each time.
// CSV columns: category,item,variety,date,price,unit. category = fruit | vegetable | cut_flowers; unit = kg | head | twin | stem; GBP; date = a Monday, about every 2 weeks.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const API_URL = "https://www.gov.uk/api/content/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average";
export const PAGE_URL = "https://www.gov.uk/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average";
export const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

export const INFO: SourceInfo = {
  id: "gb-defra-wholesale",
  country: "GB (England and Wales)",
  category: "wholesale-fresh-food (home-grown fruit and vegetables)",
  name: "DEFRA: wholesale fruit and vegetable prices, average",
  publisher: "Department for Environment, Food and Rural Affairs (DEFRA), UK Government",
  what_is_recorded:
    "For each variety of home-grown fruit and vegetables, the average of the most usual prices charged by wholesalers at the wholesale markets in Birmingham, Bristol, Manchester and London (New Spitalfields or Western International), in pounds sterling per kilogram, head, twin pack or stem.",
  price_type: "posted_price",
  freshness: "About every two weeks (a Monday date); each answer states the date its price applies to",
  licence: "Open Government Licence v3.0",
  licence_url: OGL_URL,
  attribution: "Contains public sector information licensed under the Open Government Licence v3.0. Source: DEFRA, Wholesale fruit and vegetable prices, weekly average.",
  homepage: PAGE_URL,
  limits:
    "Averages of the usual prices wholesalers charge (quoted wholesale prices), not shop prices, not individual sales and not paid prices; DEFRA gives no number of records. " +
    "England and Wales only, one series for all four markets, home-grown produce only (no imports), and only the varieties DEFRA lists. DEFRA may change or withdraw the file.",
};

export const METHOD =
  "Great Britain wholesale fruit and vegetables: the newest average wholesale price that DEFRA publishes for the item (home-grown produce at the markets in Birmingham, Bristol, Manchester and London). " +
  "We pass on the published figure and its date. When you ask for an item with several varieties (for example apples) the headline is the plain unweighted mean of the varieties priced on that date, and every variety is listed; " +
  "ask for the variety (for example 'gala apples') to get one price. It is a quoted wholesale average, not a list of sales, so no range or sample size is calculated.";

// ---------- parsing ----------

export interface Row {
  category: string; // fruit | vegetable | cut_flowers
  item: string; // e.g. apples
  variety: string; // e.g. gala
  date: string; // ISO Monday
  price: number; // GBP per unit
  unit: string; // kg | head | twin | stem
}

/** Usable rows. Cut flowers and rows without a price are dropped. Throws SourceError when the layout has changed. */
export function parseCsv(text: string): Row[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = (lines[0] ?? "").trim().toLowerCase();
  if (head !== "category,item,variety,date,price,unit") {
    throw new SourceError("DEFRA changed the layout of its wholesale price file (expected category,item,variety,date,price,unit); this source needs updating.");
  }
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",").map((s) => s.trim());
    if (c.length < 6) continue;
    const price = Number(c[4]);
    if (c[0] === "cut_flowers" || !/^\d{4}-\d{2}-\d{2}$/.test(c[3]) || !Number.isFinite(price) || price <= 0 || !c[5]) continue;
    out.push({ category: c[0], item: c[1], variety: c[2], date: c[3], price, unit: c[5] });
  }
  if (!out.length) throw new SourceError("The DEFRA wholesale price file had no usable prices; this source needs updating.");
  return out;
}

/** The CSV link from the gov.uk content API answer. Throws SourceError when there is none. */
export function csvUrlFromApi(json: any): string {
  const att = json?.details?.attachments;
  const csv = Array.isArray(att) ? att.find((a: any) => a?.content_type === "text/csv" && typeof a?.url === "string") : null;
  if (!csv || !/^https:\/\/assets\.publishing\.service\.gov\.uk\//.test(csv.url)) {
    throw new SourceError("The DEFRA wholesale price page no longer lists a CSV file; this source needs updating.");
  }
  return csv.url as string;
}

// ---------- matching ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

const ALIASES: Record<string, string> = {
  tomato: "tomatoes", potato: "potatoes", sprouts: "brussels sprouts", courgette: "courgettes", cucumber: "cucumbers", carrot: "carrots",
  pepper: "capsicum", peppers: "capsicum", "bell pepper": "capsicum", broccoli: "calabrese", "green beans": "beans", "runner beans": "beans runner climbing",
  kale: "curly kale", aubergine: "aubergines", strawberry: "strawberries", raspberry: "raspberries", cherry: "cherries", plum: "plums", pear: "pears", apple: "apples",
  leek: "leeks", parsnip: "parsnips", onion: "onion", onions: "onion", lettuces: "lettuce", spinach: "spinach leaf",
};

export interface Series { item: string; variety: string; category: string; unit: string; rows: Row[] }

/** One series per item, variety and unit, newest day first. */
export function seriesOf(rows: Row[]): Series[] {
  const m = new Map<string, Series>();
  for (const r of rows) {
    const k = `${r.item}\u0000${r.variety}\u0000${r.unit}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = { item: r.item, variety: r.variety, category: r.category, unit: r.unit, rows: [] }));
    s.rows.push(r);
  }
  for (const s of m.values()) s.rows.sort((a, b) => b.date.localeCompare(a.date));
  return [...m.values()];
}

const label = (s: Series) => (norm(s.item) === norm(s.variety) ? norm(s.item) : `${norm(s.item)} (${norm(s.variety)})`);

/** Series matching what was asked: every word of the request must appear in item + variety (word forms are folded, so 'tomato' finds 'tomatoes'). */
export function matchSeries(all: Series[], asked: string): Series[] {
  const a0 = norm(asked);
  if (!a0) return [];
  const words = (ALIASES[a0] ?? a0).split(" ").map(singular);
  return all.filter((s) => {
    const hay = norm(`${s.item} ${s.variety}`).split(" ").map(singular);
    return words.every((w) => hay.includes(w));
  });
}

export function itemHelp(all: Series[]): string {
  return [...new Set(all.map((s) => norm(s.item)))].join(", ");
}

// ---------- answer ----------

const r2 = (v: number) => Math.round(v * 100) / 100;
const UNITS: Record<string, string> = { kg: "per kg", head: "per head", twin: "per twin pack", stem: "per stem" };

export function gbWholesaleFromRows(rows: Row[], input: { product?: string; baseUrl?: string }): PriceAnswer {
  const asked = (input.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'apples', 'carrots', 'strawberries' or 'cauliflower'.");
  const all = seriesOf(rows);
  const found = matchSeries(all, asked);
  const base = { source: INFO, query: { country: "GB", product: asked }, currency: "GBP", method: METHOD, baseUrl: input.baseUrl };
  if (!found.length) {
    return buildStatisticAnswer({
      ...base, value: null, measure: "average", unit: "per kg", period: { from: null, to: null }, reference_period: "", describe: () => "",
      extra: { note: `No England and Wales wholesale price for '${asked}'. DEFRA's file covers: ${itemHelp(all)}.` },
    });
  }
  // The newest date among the matches, then the unit with most varieties on that date (kg wins ties): never mix units.
  const newest = found.map((s) => s.rows[0].date).sort().reverse()[0];
  const current = found.filter((s) => s.rows[0].date === newest);
  const byUnit = new Map<string, Series[]>();
  for (const s of current) byUnit.set(s.unit, [...(byUnit.get(s.unit) ?? []), s]);
  const unitKey = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] === "kg" ? -1 : 1))[0][0];
  const group = byUnit.get(unitKey)!;
  const unit = UNITS[unitKey] ?? `per ${unitKey}`;
  const prices = group.map((s) => s.rows[0].price);
  const value = r2(prices.reduce((x, y) => x + y, 0) / prices.length);
  const single = group.length === 1;
  const first = group[0];
  const name = single ? label(first) : norm(first.item) === norm(asked) || group.every((s) => s.item === first.item) ? norm(first.item) : asked.toLowerCase();
  const history = (s: Series) => s.rows.slice(0, 8).map((r) => ({ date: r.date, price_gbp: r.price }));
  const prev = first.rows[1];
  const changePct = single && prev ? Math.round(((first.rows[0].price - prev.price) / prev.price) * 1000) / 10 : null;
  const spread = group.map((s) => ({ item: norm(s.item), variety: norm(s.variety), price_gbp: s.rows[0].price }));
  return buildStatisticAnswer({
    ...base,
    query: { country: "GB", product: asked, item: name },
    value,
    measure: "average",
    unit,
    low: group.length > 1 ? Math.min(...prices) : null,
    high: group.length > 1 ? Math.max(...prices) : null,
    period: { from: newest, to: newest },
    reference_period: newest,
    describe: (x) =>
      single
        ? `Wholesale ${name} in England and Wales: £${x} ${unit} (average of the usual prices charged by wholesalers, for ${newest}).`
        : `Wholesale ${name} in England and Wales: £${x} ${unit} (unweighted mean of ${group.length} varieties, from £${Math.min(...prices)} to £${Math.max(...prices)}, for ${newest}).`,
    note:
      "Average of the most usual prices charged by wholesalers for home-grown produce at the markets in Birmingham, Bristol, Manchester and London: a quoted wholesale price, not a shop price and not a paid price." +
      (single ? "" : " The headline is a plain unweighted mean of the varieties; ask for one variety (for example 'gala apples') for a single price."),
    extra: {
      item: name,
      food_category: first.category,
      price_unit: unitKey,
      varieties_priced: group.length,
      varieties: spread,
      ...(single ? { recent_dates: history(first), change_on_previous_published_date_percent: changePct, previous_published_date: prev?.date ?? null } : {}),
      other_units: [...byUnit.keys()].filter((k) => k !== unitKey).map((k) => ({ unit: k, items: byUnit.get(k)!.map(label) })),
      markets: "Birmingham, Bristol, Manchester and London",
      price_basis: "posted (quoted) wholesale price",
    },
  });
}

// ---------- fetching ----------

async function getText(url: string, accept: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; rows: Row[] } | null = null;
const CACHE_MS = 6 * 3600 * 1000; // DEFRA publishes about every two weeks; the CSV is 850 KB

export async function fetchRows(): Promise<Row[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let json: any;
  try {
    json = JSON.parse(await getText(API_URL, "application/json"));
  } catch (err) {
    if (err instanceof SyntaxError) throw new SourceError("The gov.uk content API for the DEFRA wholesale prices did not return JSON.");
    throw err;
  }
  const rows = parseCsv(await getText(csvUrlFromApi(json), "text/csv", 30000));
  cache = { at: Date.now(), rows };
  return rows;
}

export async function gbWholesale(input: { product?: string; baseUrl?: string }, fetcher: () => Promise<Row[]> = fetchRows): Promise<PriceAnswer> {
  if (!input.product?.trim()) throw new InputError("product is required, for example 'apples', 'carrots', 'strawberries' or 'cauliflower'.");
  return gbWholesaleFromRows(await fetcher(), input);
}
