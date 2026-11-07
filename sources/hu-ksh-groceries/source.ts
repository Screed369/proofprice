// Hungary: average consumer prices of selected products, from the Hungarian Central Statistical Office (KSH), STADAT table 1.2.1.8
// (ara0044), the "raw data" CSV: https://www.ksh.hu/stadat_files/ara/en/ara0044.csv
// Format checked live on 2026-11-06 (GitHub probe + plain GET): semicolon-separated, windows-1250, CRLF. Line 1 = title, line 2 =
// "Code;Denomination;2017 January;...;2026 December", then one row per product; thousands separated by a space ("2 070" = 2070); ".." = no price;
// future months are empty cells. Prices in HUF, national average, monthly. KSH does not say how many quotes stand behind an average,
// so this is an official statistic: value + measure "average", range fields null, sample_size null. We keep the food and drink rows
// (codes 10001-15204, 17011, 17305, 17309, 18xxx); restaurant meals, tobacco and services in the same file are left out.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";

export const INFO: SourceInfo = {
  id: "hu-ksh-groceries",
  country: "HU (Hungary)",
  category: "groceries (average shop prices of selected products)",
  name: "Average consumer price of selected products and services, monthly (STADAT table 1.2.1.8, ara0044)",
  publisher: "Hungarian Central Statistical Office (KSH)",
  what_is_recorded:
    "For about 75 food and drink products, the national average consumer price each month (HUF per kg, litre or the pack stated), from the shop prices KSH records for its consumer price statistics. " +
    "One published average per product and month; never an individual shop or shopper.",
  price_type: "official_statistic",
  freshness: "Monthly: the September 2026 prices were published on 7 October 2026 (about one week after the month ends)",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0). KSH's copyright page (section 3) allows reuse of its published content under CC BY 4.0 with the source named and a live link.",
  licence_url: "https://www.ksh.hu/copyright",
  attribution:
    "Source: KSH (Hungarian Central Statistical Office), www.ksh.hu, STADAT table 1.2.1.8 'Average consumer price of selected products and services'. " +
    "Licensed under CC BY 4.0. Prices are passed on as published; the change on a year earlier is calculated by ProofPrice.",
  homepage: "https://www.ksh.hu/stadat_files/ara/en/ara0044.html",
  limits:
    "National averages only (no regional prices), for KSH's standard products and pack sizes; KSH does not say how many price quotes stand behind an average. " +
    "These are shop shelf prices recorded for price statistics, not receipts, and not the price at any one shop or online. " +
    "Some products (for example new potatoes out of season) have no price in some months.",
};

export const CSV_URL = "https://www.ksh.hu/stadat_files/ara/en/ara0044.csv";

// ---------- the products: everyday words -> KSH product codes ----------
// Codes and denominations are exactly KSH's (file read 2026-11-06). The first definition that lists a word is the default for it.
export const ITEMS: ItemDef[] = [
  { code: "10001", label: "Pork, short loin, kg", unit: "per kg", words: ["pork", "pork loin", "pork short loin"] },
  { code: "10003", label: "Pork leg, kg", unit: "per kg", words: ["pork leg"] },
  { code: "10103", label: "Prime rib, kg", unit: "per kg", words: ["beef", "prime rib", "beef rib"] },
  { code: "10401", label: "Chicken ready to cook, kg", unit: "per kg", words: ["chicken", "whole chicken"] },
  { code: "10405", label: "Chicken leg, kg", unit: "per kg", words: ["chicken leg", "chicken legs"] },
  { code: "10407", label: "Chicken wings, kg", unit: "per kg", words: ["chicken wings"] },
  { code: "10408", label: "Filleted turkey breast, kg", unit: "per kg", words: ["turkey breast"] },
  { code: "10409", label: "Filleted chicken breast, kg", unit: "per kg", words: ["chicken breast", "chicken fillet"] },
  { code: "10501", label: "Drysausage, kg", unit: "per kg", words: ["drysausage"] },
  { code: "10502", label: "Winter salami, kg", unit: "per kg", words: ["winter salami"] },
  { code: "10506", label: "Turkey ham, kg", unit: "per kg", words: ["turkey ham"] },
  { code: "10601", label: "Párizsi cold cuts, kg", unit: "per kg", words: ["párizsi cold cuts"] },
  { code: "10602", label: "Frankfurter sausage, kg", unit: "per kg", words: ["frankfurter sausage"] },
  { code: "10603", label: "Italian sausage, kg", unit: "per kg", words: ["italian sausage"] },
  { code: "10801", label: "Carp slice or fillet, kg", unit: "per kg", words: ["carp slice or fillet"] },
  { code: "11001", label: "Eggs, 10 pieces", unit: "per 10 eggs", words: ["eggs", "egg", "10 eggs"] },
  { code: "11101", label: "Pasteurised ESL milk, 2.8% fat content, litre", unit: "per litre", words: ["milk", "fresh milk", "cow milk", "whole milk"] },
  { code: "11103", label: "Pasteurised ESL milk, 1.5% fat content, litre", unit: "per litre", words: ["semi skimmed milk", "low fat milk"] },
  { code: "11104", label: "Long-life milk, 2.8% fat content, litre", unit: "per litre", words: ["uht milk", "long life milk"] },
  { code: "11209", label: "Trappist-style cheese block, kg", unit: "per kg", words: ["cheese", "trappist cheese", "block cheese"] },
  { code: "11301", label: "Sour cream, 20% fat content, kg", unit: "per kg", words: ["sour cream"] },
  { code: "11306", label: "Fruit yoghurt, 125–150 g", unit: "per item as described", words: ["yoghurt", "yogurt", "fruit yoghurt"] },
  { code: "11311", label: "Sour cream, 12% fat content, 300–450 g, kg", unit: "per kg", words: ["sour cream"] },
  { code: "12001", label: "Butter, 80% fat content, 100–125 g", unit: "per item as described", words: ["butter"] },
  { code: "12101", label: "Pork lard, 400–500 g", unit: "per item as described", words: ["lard", "pork lard"] },
  { code: "12201", label: "Sweet bacon, kg", unit: "per kg", words: ["bacon"] },
  { code: "12301", label: "Cooking oil, sunflower-seed, litre", unit: "per litre", words: ["sunflower oil", "cooking oil", "vegetable oil", "oil"] },
  { code: "12402", label: "Edible margarine, 60–80% fat content, 200–250 g", unit: "per item as described", words: ["margarine"] },
  { code: "13002", label: "Plain flour, kg", unit: "per kg", words: ["flour", "plain flour", "wheat flour"] },
  { code: "13003", label: "Pastry flour, kg", unit: "per kg", words: ["pastry flour"] },
  { code: "13101", label: "Husked rice, unpolished, kg", unit: "per kg", words: ["rice"] },
  { code: "13201", label: "White bread, kg", unit: "per kg", words: ["bread", "white bread", "loaf"] },
  { code: "13206", label: "Light-brown bread, kg", unit: "per kg", words: ["brown bread", "wholemeal bread"] },
  { code: "13301", label: "Roll, piece", unit: "per piece", words: ["bread roll", "roll"] },
  { code: "13305", label: "Danish pastry with cocoa, piece", unit: "per piece", words: ["danish pastry with cocoa"] },
  { code: "13404", label: "4-egg spaghetti, 400–500 g", unit: "per item as described", words: ["pasta", "spaghetti"] },
  { code: "13501", label: "Granulated sugar, kg", unit: "per kg", words: ["sugar"] },
  { code: "13601", label: "Cocoa powder, 70–200 g, tin", unit: "per tin", words: ["cocoa powder"] },
  { code: "13617", label: "Milk chocolate with hazelnuts, 80–100 g", unit: "per item as described", words: ["milk chocolate with hazelnuts"] },
  { code: "13711", label: "Boxed ice cream, litre", unit: "per litre", words: ["boxed ice cream"] },
  { code: "13801", label: "Coffee biscuits, 800–1000 g", unit: "per item as described", words: ["coffee biscuits"] },
  { code: "13910", label: "Acacia honey, kg", unit: "per kg", words: ["honey"] },
  { code: "14001", label: "New potatoes, kg", unit: "per kg", words: ["new potatoes"] },
  { code: "14002", label: "Old potatoes, kg", unit: "per kg", words: ["potatoes", "potato", "old potatoes"] },
  { code: "14101", label: "Carrots, kg", unit: "per kg", words: ["carrots", "carrot"] },
  { code: "14103", label: "Red onions, kg", unit: "per kg", words: ["onions", "onion"] },
  { code: "14104", label: "Cabbage, kg", unit: "per kg", words: ["cabbage"] },
  { code: "14107", label: "Tomatoes, kg", unit: "per kg", words: ["tomatoes", "tomato"] },
  { code: "14108", label: "Green peppers, kg", unit: "per kg", words: ["peppers", "green peppers"] },
  { code: "14110", label: "Cucumbers, kg", unit: "per kg", words: ["cucumbers", "cucumber"] },
  { code: "14111", label: "Mushrooms, kg", unit: "per kg", words: ["mushrooms"] },
  { code: "14201", label: "Apples, kg", unit: "per kg", words: ["apples", "apple"] },
  { code: "14202", label: "Watermelons, kg", unit: "per kg", words: ["watermelon", "watermelons"] },
  { code: "14209", label: "Pears, kg", unit: "per kg", words: ["pears"] },
  { code: "14221", label: "Lemons, kg", unit: "per kg", words: ["lemons"] },
  { code: "14222", label: "Bananas, kg", unit: "per kg", words: ["bananas", "banana"] },
  { code: "14224", label: "Oranges, kg", unit: "per kg", words: ["oranges"] },
  { code: "14310", label: "Boxed orange juice, 100% fruit content, 1 l, carton", unit: "per carton", words: ["orange juice", "juice"] },
  { code: "14401", label: "Quick-frozen green peas, kg", unit: "per kg", words: ["quick-frozen green peas"] },
  { code: "14425", label: "Tinned sweet corn, can", unit: "per can", words: ["tinned sweet corn"] },
  { code: "14508", label: "Fruit jam, 250–650 g, min 50%, kg", unit: "per kg", words: ["fruit jam"] },
  { code: "14601", label: "Dried beans, kg", unit: "per kg", words: ["beans", "dried beans"] },
  { code: "14701", label: "Cleaned walnuts, without sugar, kg", unit: "per kg", words: ["walnuts"] },
  { code: "15101", label: "Quick-frozen french fries, 750–1000 g", unit: "per item as described", words: ["quick-frozen french fries"] },
  { code: "15201", label: "Pepper, black, ground, 16–25 g, packet", unit: "per packet", words: ["pepper"] },
  { code: "15202", label: "Paprika, 75–100 g, kg", unit: "per kg", words: ["paprika"] },
  { code: "15204", label: "Table salt, kg", unit: "per kg", words: ["salt", "table salt"] },
  { code: "17011", label: "Ground coffee, 200–250 g, pack", unit: "per pack", words: ["coffee", "ground coffee"] },
  { code: "17305", label: "Mineral water, 1.5 l, bottle", unit: "per bottle", words: ["mineral water", "water", "bottled water"] },
  { code: "17308", label: "Mineral water, still, 1.5 l, bottle", unit: "per bottle", words: ["mineral water"] },
  { code: "17309", label: "Coca Cola or Pepsi, 1–2.5 l, bottle, litre", unit: "per litre", words: ["cola", "coca cola", "soft drink"] },
  { code: "18001", label: "White wine without geographical indication (non-PGI) in 1–2 l bottle, litre", unit: "per litre", words: ["white wine", "wine"] },
  { code: "18002", label: "Red wine without geographical indication (non-PGI) in 1–2 l, bottle, litre", unit: "per litre", words: ["red wine"] },
  { code: "18007", label: "Sparkling wine, tank-fermented, 0.75 l, bottle", unit: "per bottle", words: ["sparkling wine"] },
  { code: "18101", label: "Lager, 0.33–0.5 l bottle, litre", unit: "per litre", words: ["beer", "lager"] },
  { code: "18102", label: "Top-fermented (IPA, APA or ale) or wheat beer, 0.33–0.5 l bottle, litre", unit: "per litre", words: ["top-fermented (ipa"] },
  { code: "18204", label: "Vodka, spirits, non-flavoured, 0.5–1 l, bottle, litre", unit: "per litre", words: ["vodka"] },
  { code: "18205", label: "Unicum, 0.5 l, bottle", unit: "per bottle", words: ["unicum"] },
  { code: "18211", label: "Liquor, 0.5–0.7 l, 20–35 % alcohol content, bottle", unit: "per bottle", words: ["liquor content"] },
];

// ---------- reading the file (pure) ----------

export interface MonthValue {
  /** "2026-09" */
  month: string;
  value: number;
}

export interface KshTable {
  title: string;
  /** "2026-01" ... for every month column in the header, in file order */
  months: string[];
  /** product code -> published denomination and the months that hold a price, oldest first */
  products: Map<string, { label: string; series: MonthValue[] }>;
}

const MONTH_INDEX: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** "2026 September" -> "2026-09"; null for anything else. */
export function monthFromHeader(h: string): string | null {
  const m = /^(\d{4})\s+([A-Za-z]+)$/.exec(h.trim());
  const mm = m ? MONTH_INDEX[m[2].toLowerCase()] : undefined;
  return m && mm ? `${m[1]}-${mm}` : null;
}

/** "2 070" -> 2070; ".." or empty -> null. Spaces (also non-breaking) are thousands separators; a comma is a decimal mark. */
export function parseNumber(cell: string | undefined): number | null {
  if (cell == null) return null;
  const s = cell.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v > 0 ? v : null;
}

/** Decode the file's bytes (windows-1250) to text. */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("windows-1250").decode(bytes);
}

/** Parse the whole CSV text. Fails loudly (SourceError) when the header is not the one we checked. */
export function parseKsh(text: string): KshTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) throw new SourceError("The KSH price file has changed shape: too few lines.");
  const title = lines[0].split(";")[0].trim();
  const header = lines[1].split(";").map((h) => h.trim());
  if (header[0] !== "Code" || !/^Denomination$/i.test(header[1] ?? "")) throw new SourceError("The KSH price file has changed shape: the header row was not found.");
  const months = header.slice(2).map((h) => monthFromHeader(h) ?? "");
  if (months.filter(Boolean).length < 12) throw new SourceError("The KSH price file has changed shape: the month columns were not found.");
  const products = new Map<string, { label: string; series: MonthValue[] }>();
  for (const line of lines.slice(2)) {
    const c = line.split(";");
    const code = (c[0] ?? "").trim();
    if (!/^\d{5}$/.test(code)) continue;
    const series: MonthValue[] = [];
    months.forEach((month, i) => {
      const v = month ? parseNumber(c[i + 2]) : null;
      if (v != null) series.push({ month, value: v });
    });
    products.set(code, { label: (c[1] ?? "").trim(), series });
  }
  if (!products.size) throw new SourceError("The KSH price file has changed shape: no product rows were found.");
  return { title, months: months.filter(Boolean), products };
}

export function shiftMonth(month: string, delta: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026" */
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** How many whole months before `today` the reference month is. */
export function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 0;
  return today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

/** Newest month that any product in the file has a price for. */
export function newestMonth(t: KshTable): string | null {
  let best: string | null = null;
  for (const p of t.products.values()) {
    const last = p.series[p.series.length - 1]?.month;
    if (last && (!best || last > best)) best = last;
  }
  return best;
}

export interface KshReading {
  code: string;
  kshLabel: string;
  series: MonthValue[];
  latest: MonthValue;
  yearAgo: MonthValue | null;
  previous: MonthValue | null;
  tableLatestMonth: string | null;
  tableTitle: string | null;
}

export function readItem(t: KshTable, code: string): KshReading | null {
  const p = t.products.get(code);
  if (!p || !p.series.length) return null;
  const latest = p.series[p.series.length - 1];
  const at = (month: string | null) => (month ? p.series.find((s) => s.month === month) ?? null : null);
  return {
    code,
    kshLabel: p.label,
    series: p.series,
    latest,
    yearAgo: at(shiftMonth(latest.month, -12)),
    previous: at(shiftMonth(latest.month, -1)),
    tableLatestMonth: newestMonth(t),
    tableTitle: t.title || null,
  };
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const huf = (v: number) => `${Math.round(v).toLocaleString("en-US")} HUF`;

export function changeOver(from: MonthValue | null, to: MonthValue): null | { from_month: string; from_value: number; change_percent: number; change_amount: number } {
  if (!from || !(from.value > 0)) return null;
  return {
    from_month: from.month,
    from_value: from.value,
    change_percent: roundTo(((to.value - from.value) / from.value) * 100, 1),
    change_amount: roundTo(to.value - from.value, 2),
  };
}

function changeWords(c: NonNullable<ReturnType<typeof changeOver>>, label: string): string {
  if (c.change_percent === 0) return ` That is unchanged from ${label} (${huf(c.from_value)}).`;
  return ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than a year earlier (${huf(c.from_value)} in ${label}).`;
}

const HUNGARY_WORDS = new Set(["hu", "hungary", "hun", "national", "nationwide", "all", "whole country", "magyarorszag", "magyarország"]);

export function kshMethod(): string {
  return (
    "The Hungarian Central Statistical Office (KSH) publishes, each month, the national average consumer price of about 75 food and drink products (STADAT table 1.2.1.8), " +
    "from the shop prices it records for its consumer price statistics. ProofPrice returns the published average for the product's latest month, unchanged, with the same month a year earlier, " +
    "the month before and the last 13 months. No range is calculated: KSH gives one average and does not say how many price quotes are behind it. These are shop prices recorded for statistics, not receipts."
  );
}

export interface KshQuery {
  item: string;
  region?: string;
  baseUrl?: string;
  today?: Date;
}

export function kshAnswer(reading: KshReading | null, def: ItemDef | null, related: ItemDef[], q: KshQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "HU", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "HUF", method: kshMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !HUNGARY_WORDS.has(q.region.trim().toLowerCase())
      ? `KSH publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Hungary.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def
      ? `The KSH table holds no price for "${def.label}" (product ${def.code}).`
      : `The KSH average-price table has no standard product for "${q.item}".`;
    return {
      ...none,
      summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`,
      extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) },
    };
  }

  const r = reading;
  const today = q.today ?? new Date();
  const range = periodRange(r.latest.month);
  const behind = monthsBehind(r.latest.month, today);
  const yoy = changeOver(r.yearAgo, r.latest);
  const mom = changeOver(r.previous, r.latest);
  const notes: string[] = [];
  if (r.tableLatestMonth && r.latest.month < r.tableLatestMonth) {
    notes.push(`KSH has no price for this product in ${monthWords(r.tableLatestMonth)}; this is its latest available month.`);
  }
  if (behind >= 4) notes.push(`Old data: the newest price KSH holds for this product is from ${monthWords(r.latest.month)}, ${behind} months ago.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Hungary",
    item: { code: def.code, definition: def.label, unit: def.unit, ksh_label: r.kshLabel, asked_for: q.item },
    what_this_is: "Average shop price recorded by the Hungarian Central Statistical Office (KSH) for its consumer price statistics. Not a receipt and not the price at any one shop.",
    reference_month: r.latest.month,
    reference_month_label: monthWords(r.latest.month),
    change_on_year_earlier: yoy ? { reference_month: yoy.from_month, value: yoy.from_value, change_percent: yoy.change_percent, change_amount: yoy.change_amount } : null,
    change_on_previous_month: mom ? { reference_month: mom.from_month, value: mom.from_value, change_percent: mom.change_percent, change_amount: mom.change_amount } : null,
    last_13_months: r.series.slice(-13).map((s) => ({ month: s.month, value: s.value })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    dataset: { code: "STADAT 1.2.1.8 (ara0044)", title: r.tableTitle, latest_month_in_file: r.tableLatestMonth, url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: r.latest.value,
    unit: def.unit,
    period: range ?? { from: null, to: null },
    reference_period: r.latest.month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Hungary the national average shop price of "${def.label}" was ${huf(v)} in ${monthWords(r.latest.month)}` +
      ` (KSH consumer price statistics, not receipts).` +
      (yoy ? changeWords(yoy, monthWords(yoy.from_month)) : " No price for the same month a year earlier is available.") +
      (behind >= 4 ? ` Old data: this product has not been priced since ${monthWords(r.latest.month)}.` : ""),
    extra,
  });
}

// ---------- the request ----------

export interface KshOptions {
  /** Replace the download (tests): returns the raw file bytes. */
  loader?: () => Promise<ArrayBuffer | Uint8Array>;
  timeoutMs?: number;
}

async function download(timeoutMs: number): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(CSV_URL, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, CSV_URL, res.status);
    return await res.arrayBuffer();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", CSV_URL);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function huKshGroceries(input: KshQuery, o: KshOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday item such as 'milk', 'bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return kshAnswer(null, null, [], input);
  const bytes = await (o.loader ? o.loader() : download(o.timeoutMs ?? 20000));
  const table = parseKsh(decodeCsv(bytes));
  return kshAnswer(readItem(table, m.primary.code), m.primary, m.related, input);
}

// ---------- daily copy (stale-if-error) ----------
// www.ksh.hu answers slowly or not at all to Vercel's addresses (smoke 6 and 7 Nov 2026: "Could not reach the official source" for HU milk and eggs,
// no library copy to fall back on). The collector (GitHub Actions) reads the same file once a day and keeps the newest month of every mapped
// product. Each row is one published national average (n is NO_COUNT: KSH gives no record count), dated by the reference month.

export const NATIONAL_AREA = "ALL";

/** Pure: one library row per mapped product that has a price in the newest month of the file. Products lagging behind are left out. */
export function harvestRows(t: KshTable): HarvestResult {
  const readings = ITEMS.map((def) => ({ def, r: readItem(t, def.code) })).filter((x): x is { def: ItemDef; r: KshReading } => !!x.r);
  if (!readings.length) throw new SourceError("The KSH table held no price for any mapped product");
  const month = readings.map((x) => x.r.latest.month).sort().pop()!;
  const rows = readings
    .filter((x) => x.r.latest.month === month)
    .map((x) => {
      const v = x.r.latest.value;
      return { area: NATIONAL_AREA, item: x.def.label, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  const range = periodRange(month);
  return {
    date: range?.to ?? `${month}-28`,
    currency: "HUF",
    unit: "per kg, litre or pack (named in the item)",
    rows,
    note: `KSH STADAT 1.2.1.8: national average consumer prices for ${monthWords(month)}, ${rows.length} products. Published averages, not counts of records (no record count is published).`,
  };
}

export async function huKshHarvest(o: KshOptions & { sleep?: (ms: number) => Promise<void> } = {}): Promise<HarvestResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bytes = await (o.loader ? o.loader() : download(o.timeoutMs ?? 60000));
      return harvestRows(parseKsh(decodeCsv(bytes)));
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(5000 * attempt);
    }
  }
  throw last;
}

/** Where a request lives in the library: national rows only, the item key is KSH's denomination. */
export function huKshHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const def = matchItem(ITEMS, p.item ?? "").primary;
  return def ? { area: NATIONAL_AREA, item: def.label, label: "Hungary" } : null;
}
