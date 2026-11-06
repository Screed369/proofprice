// Austria producer prices of farm products from STATISTIK AUSTRIA ("Erzeugerpreise" / Producer prices for agricultural and forestry products).
// One OpenDocument spreadsheet per year, https://www.statistik.at/fileadmin/pages/142/Erzeugerpreise<YEAR>EN.ods, with one sheet per month
// (Jan, Feb, ... plus "Jan_annualAVG"): columns Code, Product, Unit, Austria, "vs. previous year in %", then nine provinces. Prices are EUR net of VAT.
// Checked live 2026-11-06 (file updated 4 Nov 2026, September 2026 the newest sheet). The publisher gives no count of farms or sales: every answer is an
// official statistic. Which products are ours: those the European Commission portal (eu-farm-prices) does NOT hold for Austria (rapeseed, soybeans,
// potatoes, seeds, turkey, fish, hay, straw, game, grapes). Everything else for AT (pigs, cattle, milk, eggs, cereals ...) stays with eu-farm-prices.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { OdsSheet, readOds } from "../at-home-prices/ods";

export const INFO: SourceInfo = {
  id: "at-statistik-farm-prices",
  country: "AT (Austria)",
  category: "farm-prices (producer prices of crops, seeds, fish, hay, straw and game)",
  name: "Producer prices for agricultural and forestry products, monthly (STATISTIK AUSTRIA)",
  publisher: "STATISTIK AUSTRIA",
  what_is_recorded:
    "The monthly national average price that Austrian farmers received for a product (rapeseed, soybeans, potatoes, sunflower, poppy and pumpkin seed, turkey, carp, trout, hay, straw, game, grapes), " +
    "in euro net of value-added tax, with the nine provinces' figures where published. One published figure per product and month; never individual farms or buyers.",
  price_type: "official_statistic",
  freshness: "Monthly; the September 2026 sheet was published on 4 Nov 2026 (about five weeks after the month)",
  licence:
    "STATISTIK AUSTRIA website terms: \"Provided the source 'STATISTIK AUSTRIA' is cited, and the content is reproduced accurately, it is permitted to reproduce, distribute and make the content publicly available " +
    "for both commercial and non-commercial purposes\"; where data content such as tables is otherwise modified, a note must be included stating that the content used has been edited.",
  licence_url: "https://www.statistik.at/en/about-us/responsibilities-and-principles/legal-basis/website-information",
  attribution:
    "Source: STATISTIK AUSTRIA, Producer prices for agricultural and forestry products (https://www.statistik.at/en/statistics/agriculture-and-forestry/agricultural-and-forestry-economy-and-prices/producer-prices). " +
    "Figures are passed on as published; ProofPrice has edited them: it picks one product row, adds the change on the previous month and the price per kilogram, and shows one figure instead of the table.",
  homepage: "https://www.statistik.at/en/statistics/agriculture-and-forestry/agricultural-and-forestry-economy-and-prices/producer-prices",
  limits:
    "A monthly national average price received by Austrian producers, net of VAT, not a sale, a retail price or a live price. STATISTIK AUSTRIA publishes no distribution and no number of trades, so there is no range and no sample size. " +
    "Fruit, vegetables and some other rows are empty for months without a market or for data-protection reasons; the newest month with a published figure is used and its age is stated.",
};

export const FILE_URL = (year: number) => `https://www.statistik.at/fileadmin/pages/142/Erzeugerpreise${year}EN.ods`;

// ---------- the products ----------

export type Unit = "tonne" | "kg" | "100kg" | "head";
export interface AtProduct {
  key: string;
  /** Row code(s) in the spreadsheet; the first is the headline, the others are listed as other series. */
  codes: string[];
  /** Noun phrase for sentences. */
  label: string;
  aliases: string[];
  group: string;
}

const P = (key: string, codes: string[], label: string, group: string, aliases: string[] = []): AtProduct => ({ key, codes, label, group, aliases });

export const PRODUCTS: AtProduct[] = [
  P("rapeseed", ["529"], "rapeseed", "Oilseeds", ["rape seed", "rape", "canola", "oilseed rape", "colza"]),
  P("soybeans", ["528"], "soybeans", "Oilseeds", ["soya beans", "soybean", "soya", "soy"]),
  P("sunflower seed", ["562"], "sunflower seed", "Oilseeds", ["sunflower", "sunflower seeds"]),
  P("poppy seed", ["561"], "poppy seed", "Oilseeds", ["poppy", "poppy seeds"]),
  P("pumpkin seed", ["563"], "pumpkin seed", "Oilseeds", ["pumpkin seeds", "styrian pumpkin seed"]),
  P("potatoes", ["532", "533"], "main-crop food potatoes (firm-cooking sorts)", "Potatoes", ["potato", "food potatoes", "ware potatoes"]),
  P("turkey", ["426"], "turkey (live weight)", "Poultry and fish", ["turkeys"]),
  P("carp", ["461"], "carp (live weight)", "Poultry and fish", ["carps"]),
  P("trout", ["465"], "trout (live weight)", "Poultry and fish", ["trouts"]),
  P("hay", ["551", "552"], "pressed meadow hay", "Hay and straw", ["meadow hay"]),
  P("straw", ["556"], "pressed straw", "Hay and straw", []),
  P("roe deer", ["485"], "roe deer", "Game", ["roe", "venison roe deer"]),
  P("red deer", ["486"], "deer (red deer)", "Game", ["deer", "venison"]),
  P("wild boar", ["488"], "wild boar", "Game", ["boar"]),
  P("chamois", ["487"], "chamois", "Game", []),
  P("white grapes", ["811"], "white grapes", "Grapes", ["wine grapes", "white wine grapes"]),
  P("red grapes", ["812"], "red grapes", "Grapes", ["red wine grapes"]),
];
export const AT_KEYS: string[] = PRODUCTS.map((x) => x.key);

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const INDEX = new Map<string, AtProduct>();
for (const pr of PRODUCTS) for (const n of [pr.key, ...pr.aliases]) INDEX.set(norm(n), pr);

/** The product behind a free-text name, or null when it is not one of ours (then the EU portal answers AT). */
export function atProductOf(raw: unknown): AtProduct | null {
  const n = norm(raw).replace(/ prices?$/, "");
  if (!n) return null;
  return INDEX.get(n) ?? INDEX.get(n.endsWith("s") ? n.slice(0, -1) : `${n}s`) ?? null;
}

// ---------- reading the workbook (pure) ----------

export interface Reading {
  /** Austria average, EUR in the row's unit. */
  value: number;
  /** STATISTIK AUSTRIA's own "vs. previous year in %" for that month. */
  yoyPercent: number | null;
  provinces: Record<string, number>;
}
export interface Row { code: string; name: string; unit: string }
export interface Month { month: string; readings: Map<string, Reading> }
export interface Workbook {
  rows: Map<string, Row>;
  /** Oldest first. */
  months: Month[];
}

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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

/** "." and "-" (no data / protected) and anything else that is not a number leave the cell out. Numbers come with a point (exact office:value). */
function num(s: string | undefined): number | null {
  if (s === undefined || !/^-?\d/.test(s.trim())) return null;
  const v = Number(s.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** The month a sheet is for, from its title line ("... September 2026 – in euro net prices ..."). Sheets with "annual average" in the title are not monthly. */
export function sheetMonth(sheet: OdsSheet): string | null {
  const title = (sheet.rows[0] ?? []).join(" ").replace(/ /g, " ");
  if (/annual average/i.test(title)) return null;
  const m = new RegExp(`\\b(${MONTH_WORDS.join("|")})\\s+(\\d{4})\\b`, "i").exec(title);
  if (!m) return null;
  return `${m[2]}-${String(MONTH_WORDS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`;
}

export function parseWorkbook(sheets: OdsSheet[]): Workbook {
  const rows = new Map<string, Row>();
  const months: Month[] = [];
  for (const sheet of sheets) {
    const month = sheetMonth(sheet);
    if (!month) continue;
    const header = sheet.rows.find((r) => r[0] === "Code");
    if (!header || header[3] !== "Austria") throw new SourceError("STATISTIK AUSTRIA changed the layout of its producer price sheets (no Code / Austria header); this source needs updating.");
    const provinceNames = header.slice(5).map((x) => String(x).replace(/\u00a0/g, " ").trim().replace(/^Lower Austia$/, "Lower Austria"));
    const readings = new Map<string, Reading>();
    for (const r of sheet.rows) {
      if (!/^\d+$/.test(r[0] ?? "")) continue;
      const clean = (x: unknown) => String(x ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      rows.set(r[0], { code: r[0], name: clean(r[1]), unit: clean(r[2]) });
      const value = num(r[3]);
      if (value === null || value <= 0) continue;
      const provinces: Record<string, number> = {};
      provinceNames.forEach((name, i) => {
        const v = num(r[5 + i]);
        if (name && v !== null && v > 0) provinces[name] = v;
      });
      readings.set(r[0], { value, yoyPercent: num(r[4]), provinces });
    }
    months.push({ month, readings });
  }
  if (!months.length) throw new SourceError("STATISTIK AUSTRIA's producer price file held no monthly sheet; this source needs updating.");
  months.sort((a, b) => a.month.localeCompare(b.month));
  return { rows, months };
}

export interface Point { month: string; value: number; yoyPercent: number | null; provinces: Record<string, number> }
/** One row's published figures, oldest first. */
export function seriesFor(wb: Workbook, code: string): Point[] {
  const out: Point[] = [];
  for (const m of wb.months) {
    const r = m.readings.get(code);
    if (r) out.push({ month: m.month, value: r.value, yoyPercent: r.yoyPercent, provinces: r.provinces });
  }
  return out;
}

/** The unit as we state it (per kg, per tonne, per 100 kg) and the number of kilograms in it (null: not a weight). */
export function unitOf(row: Row): { text: string; kg: number | null } {
  const u = row.unit.toLowerCase();
  if (u === "tonnes" || u === "tonne") return { text: "per tonne", kg: 1000 };
  if (u === "kg") return { text: "per kg", kg: 1 };
  if (u === "100 kg") return { text: "per 100 kg", kg: 100 };
  if (u === "per head") return { text: "per head", kg: null };
  return { text: `per ${row.unit}`, kg: null };
}
export const itemName = (pr: AtProduct, row: Row) => `${pr.label} (EUR ${unitOf(row).text})`;

// ---------- the answer (pure) ----------

export interface Ask { product: string; baseUrl?: string }

export function answerFor(pr: AtProduct, wb: Workbook, ask: Ask, now: Date = new Date()): PriceAnswer {
  const headCode = pr.codes[0];
  const row = wb.rows.get(headCode);
  if (!row) throw new SourceError(`STATISTIK AUSTRIA no longer lists ${pr.label} (row ${headCode}); this source needs updating.`);
  const unit = unitOf(row);
  const pts = seriesFor(wb, headCode);
  const base = { source: INFO, query: { country: "AT", product: pr.key }, measure: "average" as const, currency: "EUR", unit: unit.text, baseUrl: ask.baseUrl };
  const latest = pts.length ? pts[pts.length - 1] : null;
  if (!latest) {
    return buildStatisticAnswer({
      ...base, value: null, period: { from: null, to: null }, reference_period: "",
      method: "Austria (STATISTIK AUSTRIA producer prices): the latest monthly average price received by producers.",
      describe: () => "",
      note: `STATISTIK AUSTRIA published no producer price for ${pr.label} in the months of ${wb.months[0].month.slice(0, 4)} read so far (the row is empty out of season or withheld for data protection).`,
    });
  }
  const by = new Map(pts.map((x) => [x.month, x]));
  const prev = by.get(shiftMonth(latest.month, -1));
  const mom = prev
    ? { reference_month: prev.month, value: prev.value, change_percent: Math.round(((latest.value - prev.value) / prev.value) * 1000) / 10 }
    : null;
  const yoy = latest.yoyPercent !== null ? { change_percent: latest.yoyPercent } : null;
  const newest = wb.months[wb.months.length - 1].month;
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const [ly, lm] = latest.month.split("-").map(Number);
  const behind = nowIdx - (ly * 12 + (lm - 1));
  const fmt = (v: number) => fmtMoney(v, "EUR");
  const notes = [`A monthly national average price received by Austrian producers for ${monthWords(latest.month)}, net of VAT: not a sale, not a retail price and not a live price.`];
  if (latest.month !== newest) notes.push(`STATISTIK AUSTRIA has no figure for ${monthWords(newest)}, the newest month in its file, so the latest published figure (${monthWords(latest.month)}) is shown.`);
  if (behind >= 5) notes.push(`Old data: the newest month with a figure is ${monthWords(latest.month)}, ${behind} months ago.`);
  const others = pr.codes.slice(1).map((c) => {
    const r = wb.rows.get(c);
    const s = seriesFor(wb, c);
    const l = s[s.length - 1];
    return r && l ? { code: c, name: r.name, month: l.month, value: l.value, unit: unitOf(r).text } : null;
  }).filter(Boolean);
  return buildStatisticAnswer({
    ...base,
    value: latest.value,
    period: monthRange(latest.month),
    reference_period: latest.month,
    method:
      "Austria (STATISTIK AUSTRIA): the monthly national average price received by Austrian producers for the product, net of VAT, from the producer price spreadsheet. " +
      "We pass on the published average and its month, with the change on the previous month that we calculate from two published averages and the change on a year earlier as STATISTIK AUSTRIA states it; it is a monthly average, not a sale, and no range is calculated.",
    describe: (v) =>
      `In ${monthWords(latest.month)} Austrian producers received on average ${fmt(v)} ${unit.text} for ${pr.label} (net of VAT), as published by STATISTIK AUSTRIA (a monthly average, not a sale or a live price). ` +
      (yoy
        ? yoy.change_percent === 0
          ? "That is unchanged from a year earlier."
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier, as the publisher states.`
        : "STATISTIK AUSTRIA gives no year-on-year change for this month."),
    note: notes.join(" "),
    extra: {
      country_name: "Austria",
      product: { definition: pr.label, asked_for: ask.product, statistik_row: headCode, statistik_name: row.name, group: pr.group },
      what_this_is: "Monthly national average price received by producers in Austria, net of VAT, published by STATISTIK AUSTRIA. Not a sale, not a retail price and not a live price.",
      reference_month: latest.month,
      reference_month_label: monthWords(latest.month),
      published_unit: unit.text,
      ...(unit.kg ? { price_per_kg: Number((latest.value / unit.kg).toFixed(4)) } : {}),
      net_of_vat: true,
      change_on_previous_month: mom,
      change_on_year_earlier_published: yoy,
      provinces: latest.provinces,
      last_months: pts.slice(-12).map((x) => ({ month: x.month, value: x.value })),
      ...(others.length ? { other_series: others } : {}),
      edited_note: "ProofPrice has edited the table: one product row is shown with the change on the previous month and the price per kilogram.",
    },
  });
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export type FileFetcher = (year: number) => Promise<Buffer | null>;

/** The year's file, or null when the publisher has none yet (404, as in early January). */
export async function downloadFile(year: number): Promise<Buffer | null> {
  const url = FILE_URL(year);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}

export function parseFile(buf: Buffer): Workbook {
  let sheets: OdsSheet[];
  try {
    sheets = readOds(buf, { maxRowsPerSheet: 2000 });
  } catch (err: any) {
    throw new SourceError(`STATISTIK AUSTRIA's producer price file could not be read (${String(err?.message ?? err)})`);
  }
  return parseWorkbook(sheets);
}

export const CACHE_MS = 6 * 3600 * 1000;
let cache: { at: number; data: Workbook } | null = null;
/** Test hook. */
export function clearCache(): void {
  cache = null;
}

/** The workbook of the current year; in the first weeks of a year (no file yet, or no monthly sheet yet) the previous year's. Under six hours old copies are reused; if a refresh fails the older copy is used. */
export async function loadWorkbook(o: { fetcher?: FileFetcher; now?: Date } = {}): Promise<Workbook> {
  const now = o.now ?? new Date();
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.data;
  const get = o.fetcher ?? downloadFile;
  try {
    const year = now.getUTCFullYear();
    const buf = await get(year);
    let data: Workbook | null = null;
    if (buf) {
      try {
        data = parseFile(buf);
      } catch (err) {
        if (now.getUTCMonth() > 1) throw err; // January and February: a new file may still be a stub
      }
    }
    if (!data) {
      const prevBuf = await get(year - 1);
      if (!prevBuf) throw new SourceError("STATISTIK AUSTRIA has no producer price file for this year or the last", FILE_URL(year));
      data = parseFile(prevBuf);
    }
    cache = { at: now.getTime(), data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export async function atFarmPrices(input: { product?: string; baseUrl?: string }, o: { workbook?: Workbook; fetcher?: FileFetcher; now?: Date } = {}): Promise<PriceAnswer> {
  const pr = atProductOf(input.product);
  if (!pr) {
    throw new InputError(`For Austria, STATISTIK AUSTRIA publishes producer prices for these products here: ${AT_KEYS.join(", ")}. "${input.product ?? ""}" is not one of them; pigs, cattle, milk, eggs and cereals come from the European Commission portal.`);
  }
  const wb = o.workbook ?? (await loadWorkbook({ fetcher: o.fetcher, now: o.now }));
  return answerFor(pr, wb, { product: String(input.product ?? ""), baseUrl: input.baseUrl }, o.now);
}

// ---------- daily copy (stale-if-error) ----------

/** Pure: one library row per product for the newest month in the file; products with no figure that month are left out. Each row is one published average (n is NO_COUNT). */
export function harvestRows(wb: Workbook): HarvestResult {
  const newest = wb.months[wb.months.length - 1];
  const rows: DailyRow[] = [];
  for (const pr of PRODUCTS) {
    const row = wb.rows.get(pr.codes[0]);
    const r = newest.readings.get(pr.codes[0]);
    if (!row || !r) continue;
    rows.push({ area: "AT", item: itemName(pr, row), n: NO_COUNT, median: r.value, low: r.value, high: r.value, min: r.value, max: r.value });
  }
  if (!rows.length) throw new SourceError(`STATISTIK AUSTRIA's ${monthWords(newest.month)} sheet held no usable producer price`);
  return {
    date: monthRange(newest.month).to,
    currency: "EUR",
    unit: "per tonne, per kg or per 100 kg (the unit is in the product's name)",
    rows,
    note: `STATISTIK AUSTRIA producer prices for ${monthWords(newest.month)}: published monthly national averages received by Austrian producers, net of VAT, not counts of sales (no count is published).`,
  };
}

export async function atHarvest(o: { fetcher?: FileFetcher; now?: Date } = {}): Promise<HarvestResult> {
  clearCache();
  return harvestRows(await loadWorkbook(o));
}

/** Where a request lives in the library, without asking STATISTIK AUSTRIA. The unit comes from the product's row, so it is looked up by the known units below. */
const KNOWN_UNIT: Record<string, string> = { "529": "per tonne", "528": "per tonne", "562": "per tonne", "561": "per tonne", "563": "per tonne", "532": "per tonne", "426": "per 100 kg", "461": "per kg", "465": "per kg", "551": "per tonne", "556": "per tonne", "485": "per kg", "486": "per kg", "487": "per kg", "488": "per kg", "811": "per 100 kg", "812": "per 100 kg" };
export function atHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const pr = atProductOf(p.product);
  if (!pr) return null;
  return { area: "AT", item: `${pr.label} (EUR ${KNOWN_UNIT[pr.codes[0]]})`, label: `Austria, ${pr.label}` };
}
