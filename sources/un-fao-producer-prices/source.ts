// FAOSTAT Producer Prices (UN Food and Agriculture Organization): what farmers received at the farm gate, by country, crop or
// animal product and year. Format checked live on 2026-10-17 through the GitHub probe (see CLAUDE.md).
//
// The FAOSTAT API needs a token, but the bulk file is key-free:
//   https://bulks-faostat.fao.org/production/Prices_E_All_Data.zip   (8.4 MB; Prices_E_All_Data.csv inside is 39 MB; refreshed a few times a year)
// Wide CSV, one row per country + item + element:
//   "Area Code","Area Code (M49)","Area","Item Code","Item Code (CPC)","Item","Element Code","Element","Months Code","Months","Unit","Y1991","Y1991F",...,"Y2025","Y2025F"
// Area Code (M49) has a leading apostrophe ("'840"). Element 5530 = Producer Price (LCU/tonne), 5531 = SLC/tonne, 5532 = USD/tonne,
// 5539 = Producer Price Index. Empty cells = no data. Flags: A official, E estimated, I imputed, X figure from international organizations.
//
// The file is far too big to download per request, so the daily collector (harvest, on GitHub Actions) copies the newest figure of each
// country + product into the price library and requests are answered from there. Library layout (one "day" = the newest reference
// year, dated YYYY-12-31): area = ISO country code; item = FAO item name = price in the country's own currency per tonne;
// "<item>@usd" = the same in US dollars (when FAO gives it); "<item>@prev" = the year before; "<item>@year" = the year the figure is for
// (stored as a number); "<item>@est" = 1 when FAO marks the figure as not officially reported (flag other than A).
// FAO publishes one figure per country, product and year and no count of records, so n is the library placeholder 5 (nominalCounts).

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const FILE_URL = "https://bulks-faostat.fao.org/production/Prices_E_All_Data.zip";
export const CSV_NAME = "Prices_E_All_Data.csv";
export const NOMINAL_N = 5;
export const ELEMENT_LCU = "5530";
export const ELEMENT_USD = "5532";

export const INFO: SourceInfo = {
  id: "un-fao-producer-prices",
  country: "Australia, Brazil, Canada, Japan, Mexico, New Zealand, Singapore, South Korea and the United States",
  category: "producer-prices (annual farm-gate producer prices)",
  name: "FAOSTAT Producer Prices (annual)",
  publisher: "Food and Agriculture Organization of the United Nations (FAO), FAOSTAT",
  what_is_recorded:
    "The annual producer (farm-gate) price of a crop or animal product in a country, in the country's own currency per tonne (and in US dollars where FAO gives it): " +
    "the price farmers received for the product at the farm gate, as reported by the national statistics office or estimated by FAO. One figure per country, product and year; never individual sales or farms.",
  price_type: "official_statistic",
  freshness:
    "Annual. FAO refreshes the file a few times a year and the newest year is usually one to two years behind today; our copy is refreshed daily and each answer states its reference year and whether FAO marks it as estimated",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0) under the FAO statistical databases terms of use, which add that the data may not be used to promote a commercial enterprise or product: " +
    "ProofPrice passes the figures on neutrally, with FAO as the source and without endorsement",
  licence_url: "https://www.fao.org/contact-us/terms/db-terms-of-use/en/",
  attribution:
    "FAO. 2026. FAOSTAT: Producer Prices (https://www.fao.org/faostat/en/#data/PP). Licence: CC BY 4.0. Figures are passed on as published; changes by ProofPrice: the price per kilogram and the change on the previous year. " +
    "FAO does not endorse ProofPrice.",
  homepage: "https://www.fao.org/faostat/en/#data/PP",
  limits:
    "Annual farm-gate prices, not what shoppers pay and not a market quote of any day: FAO derives them from national statistics (often production value divided by quantity), so definitions differ between countries and the figures are not strictly comparable across borders. " +
    "Many figures are FAO estimates (flag E, I or X) rather than numbers reported by the country; the answer says when that is so. " +
    "There is no distribution and no count of records, so there is no range and no sample size. Figures in local currency are in current units, so a long gap in the series may reflect inflation, and US dollar figures use FAO's annual exchange rate. " +
    "The newest year is often one to two years old. Only 9 countries are enabled here (India and the United Arab Emirates have no recent producer prices in the file; South Korea has only a few products).",
};

/** ISO 3166 code -> FAOSTAT M49 area code, the country name and its currency (what element 5530 is expressed in, today). Only the ProofPrice Atlas countries for which the file holds a figure from the last three years (checked 2026-10-17: India and the United Arab Emirates have none, South Korea three products). */
export const COUNTRIES: Record<string, { m49: string; name: string; currency: string }> = {
  US: { m49: "840", name: "the United States", currency: "USD" },
  CA: { m49: "124", name: "Canada", currency: "CAD" },
  BR: { m49: "076", name: "Brazil", currency: "BRL" },
  MX: { m49: "484", name: "Mexico", currency: "MXN" },
  AU: { m49: "036", name: "Australia", currency: "AUD" },
  NZ: { m49: "554", name: "New Zealand", currency: "NZD" },
  SG: { m49: "702", name: "Singapore", currency: "SGD" },
  JP: { m49: "392", name: "Japan", currency: "JPY" },
  KR: { m49: "410", name: "South Korea", currency: "KRW" },
};

const ISO_BY_M49 = new Map(Object.entries(COUNTRIES).map(([iso, c]) => [c.m49, iso]));

// ---------- reading the zip (no dependency) ----------

/** Unzip the entries of a zip archive held in memory whose name passes `want` (stored or deflate). */
export function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("The FAOSTAT file is not a zip archive; the format may have changed and this source needs updating.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
  }
  return out;
}

async function fetchBinary(url: string, timeoutMs = 120000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

// ---------- parsing the CSV (pure) ----------

/** One CSV line with double-quoted fields ("" inside a quoted field is a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

export interface Figure {
  iso: string;
  item: string;
  /** Newest year with a price in local currency. */
  year: number;
  lcu: number;
  /** Same year in US dollars, when FAO gives it. */
  usd: number | null;
  /** The previous calendar year in local currency, when FAO gives it. */
  prev: number | null;
  /** True when FAO flags the figure as something other than an official (A) number. */
  estimated: boolean;
}

export interface Parsed {
  figures: Figure[];
  /** Reference year of this release: the newest year with at least MIN_FIGURES figures. */
  year: number;
  rowsRead: number;
}

const MIN_FIGURES = 20;

interface Series {
  lcu: Map<number, { v: number; f: string }>;
  usd: Map<number, number>;
}

/** Newest figure per enabled country and item, from the text of Prices_E_All_Data.csv. Throws SourceError with a diagnosis when the layout is not the one described above. */
export function parseProducerPrices(text: string): Parsed {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const head = splitCsvLine(lines[0] ?? "");
  const idx = (name: string) => head.indexOf(name);
  const iM49 = idx("Area Code (M49)");
  const iItem = idx("Item");
  const iElement = idx("Element Code");
  const years: { year: number; col: number; flagCol: number }[] = [];
  head.forEach((h, col) => {
    const m = /^Y(\d{4})$/.exec(h);
    if (m) years.push({ year: Number(m[1]), col, flagCol: head[col + 1] === `${h}F` ? col + 1 : -1 });
  });
  if (iM49 < 0 || iItem < 0 || iElement < 0 || !years.length) {
    throw new SourceError(`The FAOSTAT file has a layout this source does not know (header starts: ${lines[0]?.slice(0, 160) ?? "empty"})`);
  }
  const byKey = new Map<string, Series & { iso: string; item: string }>();
  let rowsRead = 0;
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    rowsRead++;
    const f = splitCsvLine(line);
    const iso = ISO_BY_M49.get((f[iM49] ?? "").replace(/^'/, "").trim());
    if (!iso) continue;
    const element = (f[iElement] ?? "").trim();
    if (element !== ELEMENT_LCU && element !== ELEMENT_USD) continue;
    const item = (f[iItem] ?? "").trim();
    if (!item) continue;
    const key = `${iso}\u0000${item}`;
    let s = byKey.get(key);
    if (!s) {
      s = { iso, item, lcu: new Map(), usd: new Map() };
      byKey.set(key, s);
    }
    for (const y of years) {
      const v = Number((f[y.col] ?? "").trim());
      if (!(v > 0) || !Number.isFinite(v)) continue;
      if (element === ELEMENT_LCU) s.lcu.set(y.year, { v, f: y.flagCol >= 0 ? (f[y.flagCol] ?? "").trim() : "" });
      else s.usd.set(y.year, v);
    }
  }
  const perYear = new Map<number, number>();
  for (const s of byKey.values()) {
    const latest = Math.max(...s.lcu.keys());
    if (Number.isFinite(latest)) perYear.set(latest, (perYear.get(latest) ?? 0) + 1);
  }
  const good = [...perYear.entries()].filter(([, c]) => c >= MIN_FIGURES).map(([y]) => y);
  const year = good.length ? Math.max(...good) : perYear.size ? Math.max(...perYear.keys()) : NaN;
  if (!Number.isFinite(year)) {
    throw new SourceError(`No usable FAOSTAT producer prices for the enabled countries (${rowsRead} rows read; header starts: ${lines[0].slice(0, 120)})`);
  }
  const figures: Figure[] = [];
  for (const s of byKey.values()) {
    if (!s.lcu.size) continue;
    const latest = Math.max(...s.lcu.keys());
    if (latest < year - 2) continue; // too old to call current
    const cur = s.lcu.get(latest)!;
    figures.push({
      iso: s.iso,
      item: s.item,
      year: latest,
      lcu: cur.v,
      usd: s.usd.get(latest) ?? null,
      prev: s.lcu.get(latest - 1)?.v ?? null,
      estimated: cur.f !== "A",
    });
  }
  figures.sort((a, b) => a.iso.localeCompare(b.iso) || a.item.localeCompare(b.item));
  return { figures, year, rowsRead };
}

const row = (area: string, item: string, v: number): DailyRow => ({ area, item, n: NOMINAL_N, median: v, low: v, high: v, min: v, max: v });

/** The library rows for a parsed release (see the layout in the header comment). */
export function toLibraryRows(figures: Figure[]): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const f of figures) {
    rows.push(row(f.iso, f.item, f.lcu));
    rows.push(row(f.iso, `${f.item}@year`, f.year));
    if (f.usd !== null) rows.push(row(f.iso, `${f.item}@usd`, f.usd));
    if (f.prev !== null) rows.push(row(f.iso, `${f.item}@prev`, f.prev));
    if (f.estimated) rows.push(row(f.iso, `${f.item}@est`, 1));
  }
  return rows;
}

export async function faoHarvest(load: () => Promise<Buffer> = () => fetchBinary(FILE_URL)): Promise<HarvestResult> {
  const zip = await load();
  const files = unzip(zip, (n) => n === CSV_NAME);
  const csv = files.get(CSV_NAME);
  if (!csv) throw new SourceError(`${CSV_NAME} is not inside the FAOSTAT zip (${zip.length} bytes)`);
  const parsed = parseProducerPrices(csv.toString("utf8"));
  const countries = new Set(parsed.figures.map((f) => f.iso));
  return {
    date: `${parsed.year}-12-31`,
    currency: "LCU",
    unit: "per tonne, in each country's own currency (item@usd = US dollars)",
    rows: toLibraryRows(parsed.figures),
    note:
      `FAOSTAT producer prices, reference year ${parsed.year}: ${parsed.figures.length} country-product figures for ${countries.size} countries from ${parsed.rowsRead} file rows. ` +
      `Each country-product holds its newest year within two years of ${parsed.year} (item@year says which). FAO publishes no count of records: n is the library placeholder ${NOMINAL_N}.`,
  };
}

// ---------- matching a product ----------

function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Everyday words -> fragments of FAO item names (any one is enough). FAO names are CPC style: "Meat of cattle with the bone, fresh or chilled", "Raw milk of cattle", "Hen eggs in shell, fresh". */
export const ALIASES: Record<string, string[]> = {
  corn: ["maize"],
  maize: ["maize"],
  beef: ["meat of cattle", "cattle"],
  veal: ["meat of cattle"],
  pork: ["meat of pig", "meat of swine", "pig", "swine"],
  pig: ["meat of pig", "meat of swine", "pig", "swine"],
  pigs: ["meat of pig", "meat of swine", "pig", "swine"],
  chicken: ["meat of chicken", "chicken"],
  poultry: ["meat of chicken", "chicken"],
  lamb: ["meat of sheep", "sheep"],
  mutton: ["meat of sheep", "sheep"],
  sheep: ["meat of sheep", "sheep"],
  egg: ["eggs"],
  eggs: ["eggs"],
  milk: ["raw milk of cattle", "raw milk"],
  soy: ["soya bean"],
  soya: ["soya bean"],
  soybean: ["soya bean"],
  soybeans: ["soya bean"],
  potato: ["potatoes"],
  tomato: ["tomatoes"],
  apple: ["apples"],
  banana: ["bananas"],
  orange: ["oranges"],
  grape: ["grapes"],
  lemon: ["lemons"],
  onion: ["onions"],
  mango: ["mangoes"],
  avocado: ["avocados"],
  strawberry: ["strawberries"],
  cotton: ["cotton"],
  sugar: ["sugar cane", "sugar beet"],
  oats: ["oats"],
  sorghum: ["sorghum"],
  rapeseed: ["rape"],
  canola: ["rape"],
};

export interface Held {
  item: string;
  year: number;
  lcu: number;
  usd: number | null;
  prev: number | null;
  estimated: boolean;
}

/** Index of the newest library day for one country: item -> figures. */
export function indexCountry(rows: { area: string; item: string; median: number }[], iso: string): Map<string, Held> {
  const by = new Map<string, Held>();
  const get = (item: string) => {
    let h = by.get(item);
    if (!h) {
      h = { item, year: NaN, lcu: NaN, usd: null, prev: null, estimated: false };
      by.set(item, h);
    }
    return h;
  };
  for (const r of rows) {
    if (r.area !== iso) continue;
    const m = /^(.*)@(year|usd|prev|est)$/.exec(r.item);
    if (!m) {
      get(r.item).lcu = r.median;
    } else if (m[2] === "year") get(m[1]).year = r.median;
    else if (m[2] === "usd") get(m[1]).usd = r.median;
    else if (m[2] === "prev") get(m[1]).prev = r.median;
    else get(m[1]).estimated = true;
  }
  for (const [k, h] of by) if (!Number.isFinite(h.lcu)) by.delete(k);
  return by;
}

/** Best match first: an exact name, then the shortest name that contains the words (or an alias of them), so "wheat" finds "Wheat" before "Wheat flour". */
export function matchProduct(items: string[], query: string): { primary: string | null; related: string[] } {
  const q = plain(query);
  if (!q) return { primary: null, related: [] };
  const words = q.split(" ").filter(Boolean);
  const fragments: string[] = [q];
  for (const w of words) for (const a of ALIASES[w] ?? []) if (!fragments.includes(a)) fragments.push(a);
  const scored: { item: string; score: number }[] = [];
  for (const item of items) {
    const p = plain(item);
    let score = 0;
    if (p === q) score = 100;
    else if (words.length && words.every((w) => p.split(" ").includes(w) || p.includes(w))) score = 50;
    else {
      const at = fragments.findIndex((fr) => p.includes(fr));
      if (at >= 0) score = 40 - at * 2; // the alias listed first wins ("beef" prefers meat of cattle over milk of cattle)
    }
    if (score) scored.push({ item, score: score - Math.min(1, p.length / 100) });
  }
  scored.sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));
  return { primary: scored[0]?.item ?? null, related: scored.slice(1, 7).map((s) => s.item) };
}

// ---------- the answer ----------

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const money = (v: number, cur: string) => `${round(v, v >= 100 ? 0 : 2).toLocaleString("en-GB")} ${cur}`;

export interface FaoQuery {
  country: string;
  product?: string;
  baseUrl?: string;
}

export function resolveCountry(country: string): { iso: string; name: string; currency: string } {
  const iso = String(country ?? "").trim().toUpperCase();
  const c = COUNTRIES[iso];
  if (!c) throw new InputError(`country must be one of: ${Object.entries(COUNTRIES).map(([k, v]) => `${k} (${v.name})`).join(", ")}. Not recognised: ${country}.`);
  return { iso, name: c.name, currency: c.currency };
}

export function faoAnswer(day: { date: string; rows: { area: string; item: string; median: number }[] }, input: FaoQuery, thisYear = new Date().getUTCFullYear()): PriceAnswer {
  const c = resolveCountry(input.country);
  const product = (input.product ?? "").trim();
  if (!product) throw new InputError("product is required, for example 'wheat', 'maize', 'beef', 'milk' or 'tomatoes'.");
  const held = indexCountry(day.rows, c.iso);
  const m = matchProduct([...held.keys()], product);
  const query = { country: c.iso, product };
  const method =
    "The latest annual producer (farm-gate) price that FAO publishes in FAOSTAT for the product in the country, from national statistics or FAO estimates, copied once a day from the FAOSTAT bulk file.";
  if (!m.primary) {
    const sample = [...held.keys()].sort().slice(0, 60);
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: c.currency, unit: "per tonne",
      period: { from: null, to: null }, reference_period: String(day.date.slice(0, 4)), method, baseUrl: input.baseUrl,
      describe: () => "",
      extra: { reason: `FAOSTAT holds no producer price for "${product}" in ${c.name}`, products_available: sample, products_available_count: held.size },
    });
  }
  const h = held.get(m.primary)!;
  const year = Number.isFinite(h.year) ? h.year : Number(day.date.slice(0, 4));
  const change = h.prev !== null ? round(((h.lcu - h.prev) / h.prev) * 100, 1) : null;
  const old = year < thisYear - 3;
  const estimate = h.estimated ? "FAO marks this figure as estimated or imputed, not reported by the country's statistics office." : undefined;
  const note = [estimate, old ? `Old data: the newest figure FAO holds is for ${year}.` : undefined].filter(Boolean).join(" ") || undefined;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: h.lcu,
    measure: "average",
    currency: c.currency,
    unit: "per tonne",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method,
    baseUrl: input.baseUrl,
    note,
    describe: (v) =>
      `Farmers in ${c.name} received about ${money(v, c.currency)} per tonne (${money(v / 1000, c.currency)} per kg) for ${m.primary} in ${year}` +
      (h.usd !== null ? `, roughly ${money(h.usd, "USD")} per tonne` : "") +
      (change !== null ? `; ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${year - 1}` : "") + ".",
    extra: {
      product_matched: m.primary,
      year,
      price_per_kg: round(h.lcu / 1000, 4),
      usd_per_tonne: h.usd,
      previous_year: h.prev !== null ? year - 1 : null,
      previous_year_price: h.prev,
      change_on_previous_year_pct: change,
      estimated_by_fao: h.estimated,
      stage: "farm gate (producer price)",
      related_products: m.related,
    },
  });
}

export async function faoProducerPrices(input: FaoQuery): Promise<PriceAnswer> {
  resolveCountry(input.country);
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Not yet available: ProofPrice collects the FAOSTAT producer prices daily; data appears after the next collection.");
  return faoAnswer(day, input);
}
