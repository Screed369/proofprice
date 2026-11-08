// Poland farm-gate prices from Statistics Poland (GUS), monthly publication "Prices of agricultural products".
// Page: https://publikacje.new.stat.gov.pl/en/publications-portal/prices-agricultural-products-<month>-<year> (month in English, lower case).
// The page links one "Tables in XLSX format" workbook (the name changes each month: take the link from the page HTML; a separate "Charts" workbook is ignored).
// Sheets: Tabl_1 national (procurement prices PLN excl. VAT with the month-on-month and year-on-year indices, and market-place prices),
// Tabl_2 procurement prices by 16 voivodships, Tabl_3 market-place prices by voivodship. Checked live 2026-11-08 (September 2026, released 22 Oct 2026).
// Folder name: sorts BEFORE eu-farm-prices on purpose. Two sources of one category and country are chosen by folder order (first serves() that says yes),
// and eu-farm-prices serves every PL question; this source answers PL only for the products GUS publishes and lets the rest fall through.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { readXlsx, type Sheet } from "../../categories/rent/xlsx";

export const INFO: SourceInfo = {
  id: "pl-gus-farm-prices",
  country: "PL (Poland)",
  category: "farm-prices (procurement prices paid to Polish farmers)",
  name: "Prices of agricultural products, monthly (Statistics Poland, GUS)",
  publisher: "Statistics Poland (Główny Urząd Statystyczny, GUS)",
  what_is_recorded:
    "The monthly national average procurement price that buyers paid Polish farmers for wheat, rye, barley, triticale, oats, maize, potatoes, cattle, pigs, poultry and cows' milk, in zloty excluding VAT, " +
    "with the 16 voivodships' figures, the price farmers received on market places where published, and GUS's own month-on-month and year-on-year indices. One published figure per product and month; never individual farms or buyers.",
  price_type: "official_statistic",
  freshness: "Monthly; the September 2026 tables were published on 22 Oct 2026 (about three weeks after the month)",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated in the footer of the GUS publications portal.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/legalcode.en",
  attribution:
    "Source: Statistics Poland (GUS), Prices of agricultural products (https://publikacje.new.stat.gov.pl/en/publications-portal/prices-agricultural-products-september-2026), CC BY 4.0. " +
    "Figures are passed on as published; ProofPrice has edited them: it picks one product row and shows one figure instead of the table.",
  homepage: "https://publikacje.new.stat.gov.pl/en/publications-portal",
  limits:
    "A monthly national average procurement price paid to Polish farmers by buyers that are legal persons, excluding VAT, computed by GUS from value and quantity: not a sale, a retail price or a live price. " +
    "GUS publishes no distribution and no number of trades, so there is no range and no sample size. Cells GUS marks '.' or '-' (no data) are left out.",
};

export const PAGE_URL = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `https://publikacje.new.stat.gov.pl/en/publications-portal/prices-agricultural-products-${MONTH_WORDS[m - 1]}-${y}`;
};

// ---------- the products ----------

export interface PlProduct {
  key: string;
  /** Row label start in Tabl_1 (after cleaning footnote letters), lower case. */
  row: string;
  label: string;
  /** Column of the product in Tabl_2 / Tabl_3 (0 = first data column after the voivodship name). */
  col2: number;
  col3: number | null;
  unit: string; // "per dt (100 kg)", "per kg live weight", "per hl"
  kg: number | null;
  aliases: string[];
  group: string;
}
const P = (key: string, row: string, label: string, col2: number, col3: number | null, unit: string, kg: number | null, group: string, aliases: string[] = []): PlProduct => ({ key, row, label, col2, col3, unit, kg, group, aliases });
export const PRODUCTS: PlProduct[] = [
  P("wheat", "wheat", "wheat", 0, 0, "per dt (100 kg)", 100, "Cereals", ["common wheat", "bread wheat"]),
  P("rye", "rye", "rye", 1, 1, "per dt (100 kg)", 100, "Cereals"),
  P("barley", "barley", "barley", 2, 2, "per dt (100 kg)", 100, "Cereals"),
  P("triticale", "triticale", "triticale", 3, 3, "per dt (100 kg)", 100, "Cereals"),
  P("oats", "oat", "oats", 4, 4, "per dt (100 kg)", 100, "Cereals", ["oat"]),
  P("maize", "maize", "maize (corn)", 5, 5, "per dt (100 kg)", 100, "Cereals", ["corn"]),
  P("potatoes", "potatoes", "potatoes (all kinds, procurement)", 6, 6, "per dt (100 kg)", 100, "Potatoes", ["potato"]),
  P("cattle", "cattle", "cattle for slaughter (excluding calves)", 8, null, "per kg live weight", 1, "Animals for slaughter", ["beef cattle", "cow", "cows", "beef", "bull", "bulls"]),
  P("pigs", "pigs", "pigs for slaughter", 9, null, "per kg live weight", 1, "Animals for slaughter", ["pig", "hogs", "hog", "pork", "swine"]),
  P("poultry", "poultry", "poultry for slaughter", 10, null, "per kg live weight", 1, "Animals for slaughter", ["chicken", "chickens", "broilers"]),
  P("milk", "cows", "cows' milk", 11, null, "per hl", null, "Milk", ["cow milk", "cows milk", "raw milk", "cow's milk"]),
];
export const PL_KEYS: string[] = PRODUCTS.map((p) => p.key);

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const INDEX = new Map<string, PlProduct>();
for (const pr of PRODUCTS) for (const n of [pr.key, ...pr.aliases]) INDEX.set(norm(n), pr);

/** The product behind a free-text name, or null when it is not one of ours (then the EU portal answers PL). */
export function plProductOf(raw: unknown): PlProduct | null {
  const n = norm(raw).replace(/ prices?$/, "");
  if (!n) return null;
  return INDEX.get(n) ?? INDEX.get(n.endsWith("s") ? n.slice(0, -1) : `${n}s`) ?? null;
}

// ---------- reading the workbook (pure) ----------

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_LABELS = MONTH_WORDS.map((w) => w[0].toUpperCase() + w.slice(1));
export const monthWords = (m: string) => m.replace(/^(\d{4})-(\d{2})$/, (_, y, mm) => `${MONTH_LABELS[Number(mm) - 1]} ${y}`);
export function monthRange(m: string): { from: string; to: string } {
  const x = /^(\d{4})-(\d{2})$/.exec(m);
  if (!x || Number(x[2]) < 1 || Number(x[2]) > 12) throw new SourceError(`Unexpected month: ${m}`);
  const last = new Date(Date.UTC(Number(x[1]), Number(x[2]), 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}
export function shiftMonth(m: string, delta: number): string {
  const x = /^(\d{4})-(\d{2})$/.exec(m)!;
  const idx = Number(x[1]) * 12 + (Number(x[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** GUS marks missing cells '.' or '-'. Numbers are text with a dot decimal. */
function num(c: unknown): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = String(c ?? "").trim();
  if (!/^-?\d/.test(s)) return null;
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
const clean = (c: unknown) => String(c ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** Footnote letters are glued to labels ("Potatoesb – per dt", "Cattle (excl. calves)c", "Cereal graina"): the key is the first word(s) lower case. */
const rowKey = (label: string) => clean(label).toLowerCase();

export interface Reading {
  /** Procurement price, PLN in the product's unit. */
  value: number;
  /** GUS index: previous month = 100. */
  momIndex: number | null;
  /** GUS index: same month a year earlier = 100. */
  yoyIndex: number | null;
  /** Market-place price received by farmers, PLN, where published. */
  market: number | null;
  voivodships: Record<string, number>;
  marketVoivodships: Record<string, number>;
}
export interface Tables { month: string; readings: Map<string, Reading> }

export function tablesMonth(sheets: Sheet[]): string {
  const t1 = sheets.find((s) => s.name === "Tabl_1");
  const title = clean(t1?.rows?.[0]?.[0]);
  const m = new RegExp(`\\b(${MONTH_WORDS.join("|")})\\s+(\\d{4})\\b`, "i").exec(title);
  if (!m) throw new SourceError("GUS changed the layout of its agricultural price tables (no month in the title of Tabl_1); this source needs updating.");
  return `${m[2]}-${String(MONTH_WORDS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`;
}

export function parseTables(sheets: Sheet[]): Tables {
  const t1 = sheets.find((s) => s.name === "Tabl_1");
  const t2 = sheets.find((s) => s.name === "Tabl_2");
  const t3 = sheets.find((s) => s.name === "Tabl_3");
  if (!t1 || !t2) throw new SourceError("GUS changed the layout of its agricultural price tables (Tabl_1 or Tabl_2 missing); this source needs updating.");
  const month = tablesMonth(sheets);
  const header = t1.rows.find((r) => clean(r[0]).toUpperCase() === "SPECIFICATION");
  if (!header || !/procurement/i.test(clean(header[1]))) throw new SourceError("GUS changed the layout of its agricultural price tables (no SPECIFICATION / Procurement prices header in Tabl_1); this source needs updating.");
  // voivodship rows: after the row whose first cell is POLAND / POLSKA, until a blank or footnote row
  const voiv = (sheet: Sheet | undefined, national: RegExp, col: number | null): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!sheet || col === null) return out;
    let on = false;
    for (const r of sheet.rows) {
      const name = clean(r[0]);
      if (!on) { if (national.test(name)) on = true; continue; }
      if (!name || r.length < 3) break;
      const v = num(r[1 + col]);
      if (v !== null && v > 0) out[name] = v;
    }
    return out;
  };
  const readings = new Map<string, Reading>();
  for (const pr of PRODUCTS) {
    const r = t1.rows.find((x) => {
      const k = rowKey(String(x[0] ?? ""));
      return num(x[1]) !== null && k.startsWith(pr.row);
    });
    if (!r) continue;
    const value = num(r[1]);
    if (value === null || value <= 0) continue;
    const market = num(r[4]);
    readings.set(pr.key, {
      value,
      momIndex: num(r[2]),
      yoyIndex: num(r[3]),
      market: market !== null && market > 0 ? market : null,
      voivodships: voiv(t2, /^poland$/i, pr.col2),
      marketVoivodships: voiv(t3, /^polska$/i, pr.col3),
    });
  }
  if (!readings.size) throw new SourceError("GUS's agricultural price tables held no usable product row; this source needs updating.");
  return { month, readings };
}

/** The "Tables in XLSX format" link in the monthly page HTML (the Charts workbook is ignored). Null when the page has none. */
export function findTablesUrl(html: string): string | null {
  const re = /(?:https:\/\/publikacje\.new\.stat\.gov\.pl)?\/?sites\/default\/files\/[^"'<>\s]*?\.xlsx/g;
  for (const m of html.matchAll(re)) {
    if (/harts/i.test(m[0])) continue;
    const u = m[0];
    return u.startsWith("http") ? u : `https://publikacje.new.stat.gov.pl/${u.replace(/^\//, "")}`;
  }
  return null;
}

// ---------- the answer (pure) ----------

export interface Ask { product: string; baseUrl?: string }
const pct = (idx: number | null) => (idx === null ? null : Math.round((idx - 100) * 10) / 10);

export function answerFor(pr: PlProduct, t: Tables, ask: Ask, now: Date = new Date()): PriceAnswer {
  const r = t.readings.get(pr.key);
  const base = { source: INFO, query: { country: "PL", product: pr.key }, measure: "average" as const, currency: "PLN", unit: pr.unit, baseUrl: ask.baseUrl };
  if (!r) {
    return buildStatisticAnswer({
      ...base, value: null, period: { from: null, to: null }, reference_period: "",
      method: "Poland (GUS agricultural prices): the latest monthly average procurement price.",
      describe: () => "",
      note: `GUS published no procurement price for ${pr.label} in ${monthWords(t.month)}.`,
    });
  }
  const mom = pct(r.momIndex);
  const yoy = pct(r.yoyIndex);
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const [y, m] = t.month.split("-").map(Number);
  const behind = nowIdx - (y * 12 + (m - 1));
  const fmt = (v: number) => fmtMoney(v, "PLN");
  const notes = [`A monthly national average procurement price paid to Polish farmers for ${monthWords(t.month)}, excluding VAT: not a sale, not a retail price and not a live price.`];
  if (behind >= 4) notes.push(`Old data: the newest month in GUS's tables is ${monthWords(t.month)}, ${behind} months ago.`);
  return buildStatisticAnswer({
    ...base,
    value: r.value,
    period: monthRange(t.month),
    reference_period: t.month,
    method:
      "Poland (Statistics Poland, GUS): the monthly national average procurement price that buyers paid Polish farmers for the product, excluding VAT, from the table 'Prices of agricultural products'. " +
      "We pass on the published average and its month, with the month-on-month and year-on-year changes as GUS states them in its indices; it is a monthly average, not a sale, and no range is calculated.",
    describe: (v) =>
      `In ${monthWords(t.month)} buyers paid Polish farmers on average ${fmt(v)} ${pr.unit} for ${pr.label} (excluding VAT), as published by Statistics Poland (GUS; a monthly average, not a sale or a live price). ` +
      (yoy === null ? "GUS gives no year-on-year change for this month." : yoy === 0 ? "That is unchanged from a year earlier." : `That is ${Math.abs(yoy)}% ${yoy > 0 ? "higher" : "lower"} than a year earlier, as GUS states.`),
    note: notes.join(" "),
    extra: {
      country_name: "Poland",
      product: { definition: pr.label, asked_for: ask.product, group: pr.group },
      what_this_is: "Monthly national average procurement price paid to farmers in Poland by buyers that are legal persons, excluding VAT, published by Statistics Poland (GUS). Not a sale, not a retail price and not a live price.",
      reference_month: t.month,
      reference_month_label: monthWords(t.month),
      published_unit: pr.unit,
      ...(pr.kg ? { price_per_kg: Number((r.value / pr.kg).toFixed(4)) } : {}),
      net_of_vat: true,
      change_on_previous_month_percent: mom,
      change_on_year_earlier_percent: yoy,
      ...(r.market !== null ? { market_place_price_received_by_farmers: r.market, market_place_note: "Prices farmers received selling directly on market places; a different measure from the procurement price." } : {}),
      voivodships: r.voivodships,
      ...(Object.keys(r.marketVoivodships).length ? { market_place_voivodships: r.marketVoivodships } : {}),
      edited_note: "ProofPrice has edited the tables: one product row is shown with the indices turned into percent changes.",
    },
  });
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export interface Fetchers { page?: (month: string) => Promise<string | null>; file?: (url: string) => Promise<Buffer> }

async function get(url: string, kind: "text" | "buf", absent: number[] = [404]): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (absent.includes(res.status)) return { status: res.status, body: null };
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return { status: res.status, body: kind === "text" ? await res.text() : Buffer.from(await res.arrayBuffer()) };
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}
// GUS answers HTTP 403 (not 404) for a month page it has not published yet (checked 2026-11-08: october-2026 and november-2026 gave 403, september-2026 200).
const defaultPage = async (month: string) => (await get(PAGE_URL(month), "text", [403, 404])).body as string | null;
const defaultFile = async (url: string) => (await get(url, "buf")).body as Buffer;

export function parseFile(buf: Buffer): Tables {
  let sheets: Sheet[];
  try {
    sheets = readXlsx(buf);
  } catch (err: any) {
    throw new SourceError(`GUS's agricultural price workbook could not be read (${String(err?.message ?? err)})`);
  }
  return parseTables(sheets);
}

export const CACHE_MS = 6 * 3600 * 1000;
let cache: { at: number; data: Tables } | null = null;
/** Test hook. */
export function clearCache(): void {
  cache = null;
}

/** The newest published month: try this month, then back up to four months until a page with a Tables workbook answers. Under six hours old copies are reused; if a refresh fails the older copy is used. */
export async function loadTables(o: { fetchers?: Fetchers; now?: Date } = {}): Promise<Tables> {
  const now = o.now ?? new Date();
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.data;
  const page = o.fetchers?.page ?? defaultPage;
  const file = o.fetchers?.file ?? defaultFile;
  try {
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    let data: Tables | null = null;
    for (let back = 0; back <= 4 && !data; back++) {
      const html = await page(shiftMonth(thisMonth, -back));
      const url = html ? findTablesUrl(html) : null;
      if (url) data = parseFile(await file(url));
    }
    if (!data) throw new SourceError("GUS has published no agricultural price tables in the last five months", "https://publikacje.new.stat.gov.pl/en/publications-portal");
    cache = { at: now.getTime(), data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export async function plFarmPrices(input: { product?: string; baseUrl?: string }, o: { tables?: Tables; fetchers?: Fetchers; now?: Date } = {}): Promise<PriceAnswer> {
  const pr = plProductOf(input.product);
  if (!pr) {
    throw new InputError(`For Poland, Statistics Poland (GUS) publishes procurement prices for: ${PL_KEYS.join(", ")}. "${input.product ?? ""}" is not one of them; other products come from the European Commission portal.`);
  }
  const t = o.tables ?? (await loadTables({ fetchers: o.fetchers, now: o.now }));
  return answerFor(pr, t, { product: String(input.product ?? ""), baseUrl: input.baseUrl }, o.now);
}

// ---------- daily copy (stale-if-error) ----------

export const itemName = (pr: PlProduct) => `${pr.label} (PLN ${pr.unit})`;

/** Pure: one library row per product for the newest month; products with no figure are left out. Each row is one published average (n is NO_COUNT). */
export function harvestRows(t: Tables): HarvestResult {
  const rows: DailyRow[] = [];
  for (const pr of PRODUCTS) {
    const r = t.readings.get(pr.key);
    if (!r) continue;
    rows.push({ area: "PL", item: itemName(pr), n: NO_COUNT, median: r.value, low: r.value, high: r.value, min: r.value, max: r.value });
  }
  if (!rows.length) throw new SourceError(`GUS's ${monthWords(t.month)} tables held no usable procurement price`);
  return {
    date: monthRange(t.month).to,
    currency: "PLN",
    unit: "per dt (100 kg), per kg live weight or per hl (the unit is in the product's name)",
    rows,
    note: `Statistics Poland procurement prices for ${monthWords(t.month)}: published monthly national averages paid to Polish farmers, excluding VAT, not counts of sales (no count is published).`,
  };
}

export async function plHarvest(o: { fetchers?: Fetchers; now?: Date } = {}): Promise<HarvestResult> {
  clearCache();
  return harvestRows(await loadTables(o));
}

export function plHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const pr = plProductOf(p.product);
  if (!pr) return null;
  return { area: "PL", item: itemName(pr), label: `Poland, ${pr.label}` };
}
