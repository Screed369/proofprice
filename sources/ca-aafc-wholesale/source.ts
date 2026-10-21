// Canada wholesale fresh fruit and vegetables: Agriculture and Agri-Food Canada (AAFC) "Weekly Wholesale Prices" (Open Government Licence - Canada).
// Format checked 2026-10-21 from GitHub's servers (probe): a key-free plain GET of
//   https://od-do.agr.gc.ca/WeeklyWholesalePrices_PrixDeGrossistesHebdomadaires55.csv  (16 MB, the last 55 weeks, rebuilt nightly; UTF-8 with BOM)
// Columns: Date, CentreEn_CentreAn ("Wholesale-Calgary" | Edmonton | Vancouver | Winnipeg), CentreFr_CentreFr, CmdtyEn_PrdtAn (commodity), CmdtyEn_PrdtFr,
//   VrtyEn_VrteAn (variety), VrtyFr_VrteFr, GradeEn_CtgryAn, GradeFr_CtgryFr, Cntry_Pays (origin country), ProvState_ProvEtat (origin province/state),
//   LowPrice_PrixMin, HighPrice_PrixMax (CAD per package), PkgTypeEn_EmpqtgAn ("Ctn 12X100 Gr"), PkgTypeFr_EmpqtgFr, CntrTypeEn_TypeCntrAn, CntrTypeFr_TypeCntrFr,
//   PkgQty_QtePqt (packs in the carton; often blank = 1), PkgWt_PdsPqt (weight of one pack; blank for count packs), UnitMsrEn_QteUnitAn (lbs | Gr | Oz | kg | Lt | Pt), UnitMsrFr_QteUnitFr,
//   PkgSizeEn_TaillePqtAn, PkgSizeFr_TaillePqtFr. One row per centre, product, variety, grade, origin and package, per week (a Friday).
// AAFC describes these as the prices wholesalers ask retail buyers: a quoted price, never a paid price.
//
// The daily collector (harvest) downloads the file once, takes the newest week, converts every quote with a known weight to Canadian dollars per kilogram
// (the middle of the low and high price, divided by the kilograms in the package) and keeps, per centre and commodity, the median, 10th-90th percentile,
// lowest, highest and the number of quotes (needs 5 or more). Requests are answered from the library.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://od-do.agr.gc.ca/WeeklyWholesalePrices_PrixDeGrossistesHebdomadaires55.csv";
export const PAGE_URL = "https://open.canada.ca/data/en/dataset/b52424ca-ebb8-4847-808e-d525120b55df";
export const OGL_URL = "https://open.canada.ca/en/open-government-licence-canada";
export const COLLECTOR_USER_AGENT = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
/** The fewest quotes behind a published range (the platform-wide 5-record rule). */
export const MIN_QUOTES = 5;

export const INFO: SourceInfo = {
  id: "ca-aafc-wholesale",
  country: "CA (Canada: Calgary, Edmonton, Vancouver, Winnipeg)",
  category: "wholesale-fresh-food (fresh fruit and vegetables)",
  name: "AAFC: weekly wholesale prices of fresh fruit and vegetables",
  publisher: "Agriculture and Agri-Food Canada (AAFC), Government of Canada",
  what_is_recorded:
    "Every week, for four wholesale centres (Calgary, Edmonton, Vancouver and Winnipeg), the low and high price in Canadian dollars that wholesalers quote for each fruit or vegetable, variety, grade, origin and package. " +
    "ProofPrice converts the quotes that state a package weight to dollars per kilogram.",
  price_type: "posted_price",
  freshness: "Weekly (a Friday date); our copy is refreshed daily and each answer states the week its quotes apply to",
  licence: "Open Government Licence - Canada",
  licence_url: OGL_URL,
  attribution: "Contains information licensed under the Open Government Licence - Canada. Source: Agriculture and Agri-Food Canada, Weekly Wholesale Prices. Per-kilogram figures are calculated by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Quoted (asking) wholesale prices that wholesalers offer to retail buyers, not shop prices, not sales and not paid prices. Four western centres only. " +
    "The range is across the week's quotes (varieties, grades, origins and package sizes of the commodity), not across customers; the sample size is the number of quotes. " +
    "Only quotes that state the weight of the package can be converted to a price per kilogram; packs sold by count (for example a bunch or a dozen) are left out. AAFC may change or withdraw the file.",
};

export const METHOD =
  "Canada wholesale fresh fruit and vegetables: from the Agriculture and Agri-Food Canada weekly file of wholesalers' quoted prices, the newest week. " +
  "Each quote (a low and a high price for one variety, grade, origin and package at one centre) becomes one price per kilogram: the middle of the low and high price divided by the kilograms in the package. " +
  "The answer is the median of those quotes with the 10th to 90th percentile, the lowest and the highest, and the number of quotes. They are asking prices, not paid prices.";

// ---------- parsing ----------

export interface Quote {
  date: string; // ISO Friday
  centre: string; // Calgary
  commodity: string; // apples
  perKg: number; // CAD per kg
}

/** One CSV line into fields; double quotes protect commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const HEADER = ["Date", "CentreEn_CentreAn", "CentreFr_CentreFr", "CmdtyEn_PrdtAn", "CmdtyEn_PrdtFr", "VrtyEn_VrteAn", "VrtyFr_VrteFr", "GradeEn_CtgryAn", "GradeFr_CtgryFr", "Cntry_Pays", "ProvState_ProvEtat", "LowPrice_PrixMin", "HighPrice_PrixMax", "PkgTypeEn_EmpqtgAn", "PkgTypeFr_EmpqtgFr", "CntrTypeEn_TypeCntrAn", "CntrTypeFr_TypeCntrFr", "PkgQty_QtePqt", "PkgWt_PdsPqt", "UnitMsrEn_QteUnitAn"];

const KG_PER: Record<string, number> = { kg: 1, gr: 0.001, g: 0.001, lbs: 0.45359237, lb: 0.45359237, oz: 0.028349523125 };

export const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Kilograms in one carton, or null when the package weight is not stated in a weight unit. */
export function cartonKg(qty: string, wt: string, unit: string): number | null {
  const k = KG_PER[unit.trim().toLowerCase()];
  const w = Number(wt);
  if (!k || !Number.isFinite(w) || w <= 0) return null;
  const q = qty.trim() === "" ? 1 : Number(qty);
  if (!Number.isFinite(q) || q <= 0) return null;
  return q * w * k;
}

/**
 * All usable quotes of the newest week in the file. Throws SourceError when the layout is not the one checked on 2026-10-21.
 * Quotes without a stated weight, with a non-positive price or with a price per kg outside 0.05-200 CAD are dropped.
 */
export function parseNewestWeek(text: string): { date: string; quotes: Quote[]; totalRows: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const head = splitCsvLine(lines[0] ?? "");
  for (let i = 0; i < HEADER.length; i++) {
    if (head[i] !== HEADER[i]) {
      throw new SourceError(`AAFC changed the layout of its weekly wholesale price file (column ${i + 1}: expected ${HEADER[i]}, found ${head[i] ?? "nothing"}); this source needs updating.`);
    }
  }
  // Pass 1: the newest date. Pass 2: the quotes of that date.
  let newest = "";
  let totalRows = 0;
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      totalRows++;
      if (d > newest) newest = d;
    }
  }
  if (!newest) throw new SourceError("The AAFC weekly wholesale price file had no dated rows; this source needs updating.");
  const quotes: Quote[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].startsWith(newest)) continue;
    const c = splitCsvLine(lines[i]);
    const low = Number(c[11]);
    const high = Number(c[12]);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) continue;
    const kg = cartonKg(c[17] ?? "", c[18] ?? "", c[19] ?? "");
    if (!kg) continue;
    const perKg = (low + high) / 2 / kg;
    if (!(perKg >= 0.05 && perKg <= 200)) continue;
    const centre = (c[1] ?? "").replace(/^Wholesale-/i, "").trim();
    const commodity = clean(c[3] ?? "");
    if (!centre || !commodity) continue;
    quotes.push({ date: newest, centre, commodity, perKg });
  }
  return { date: newest, quotes, totalRows };
}

/** Library rows: per centre and commodity, and "ALL" for all centres; rows with fewer than MIN_QUOTES quotes are left out. */
export function libraryRows(quotes: Quote[]): DailyRow[] {
  return aggregateDaily(quotes.map((q) => ({ area: q.centre, item: q.commodity, price: q.perKg })))
    .filter((r) => r.n >= MIN_QUOTES)
    .map((r) => ({ ...r, median: round3(r.median), low: round3(r.low), high: round3(r.high), min: round3(r.min), max: round3(r.max) }));
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------- the daily collector ----------

async function download(url: string): Promise<string> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(url, { headers: { "user-agent": COLLECTOR_USER_AGENT }, signal: controller.signal });
      if (res.ok) return await res.text();
      lastError = `HTTP ${res.status}`;
    } catch (e: any) {
      lastError = String(e?.cause?.code ?? e?.message ?? e);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw new SourceError(`AAFC file could not be downloaded (${lastError})`);
}

export function harvestFromText(text: string): HarvestResult {
  const week = parseNewestWeek(text);
  const rows = libraryRows(week.quotes);
  if (!rows.length) throw new SourceError("The newest AAFC week held no commodity with 5 or more quotes that state a package weight; this source needs checking.");
  return {
    date: week.date,
    currency: "CAD",
    unit: "per kg",
    rows,
    note:
      `AAFC weekly wholesale quotes for ${week.date}: ${week.quotes.length} quotes with a stated package weight, converted to CAD per kg (middle of low and high price). ` +
      "n is the number of quotes, not sales. Asking prices.",
  };
}

export async function caAafcHarvest(): Promise<HarvestResult> {
  return harvestFromText(await download(CSV_URL));
}

// ---------- reading the library ----------

export interface Snapshot {
  date: string;
  /** area -> commodity -> row */
  byArea: Map<string, Map<string, DailyRow>>;
}

export function snapshotOf(day: { date: string; rows: DailyRow[] }): Snapshot {
  const byArea = new Map<string, Map<string, DailyRow>>();
  for (const r of day.rows) {
    let m = byArea.get(r.area);
    if (!m) byArea.set(r.area, (m = new Map()));
    m.set(r.item, r);
  }
  return { date: day.date, byArea };
}

const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (s: string) => clean(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(singular);

const ALIASES: Record<string, string> = { tomato: "tomatoes", potato: "potatoes", grape: "grapes (table)", grapes: "grapes (table)", chinese: "chinese vegetables", mushroom: "mushrooms" };

/** Commodities whose name contains every word asked (word forms folded), exact name first. */
export function matchCommodities(commodities: string[], asked: string): string[] {
  const a = ALIASES[clean(asked)] ?? asked;
  const aw = words(a);
  if (!aw.length) return [];
  const exact = commodities.filter((c) => words(c).join(" ") === aw.join(" "));
  if (exact.length) return exact;
  return commodities.filter((c) => {
    const cw = words(c);
    return aw.every((w) => cw.includes(w));
  });
}

export function centreKey(snap: Snapshot, market?: string): string | null {
  const m = clean(market ?? "").replace(/^wholesale-?\s*/, "");
  if (!m || ["canada", "all", "ca", "national", "any"].includes(m)) return NATIONAL;
  for (const a of snap.byArea.keys()) if (a !== NATIONAL && clean(a) === m) return a;
  return null;
}

// ---------- the answer (pure) ----------

const money = (v: number) => `C$${v.toFixed(2)}`;
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export interface CaQuery {
  product?: string;
  market?: string;
  baseUrl?: string;
}

export function caAafcAnswer(snap: Snapshot, q: CaQuery): PriceAnswer {
  const asked = (q.product ?? "").trim();
  if (!asked) throw new InputError("product is required, for example 'apples', 'carrots', 'bananas' or 'cauliflower'.");
  const area = centreKey(snap, q.market);
  const centres = [...snap.byArea.keys()].filter((a) => a !== NATIONAL).sort();
  if (!area) {
    throw new InputError(`market must be one of the AAFC wholesale centres: ${centres.join(", ")}; leave it out for all centres together. Not recognised: ${q.market}.`);
  }
  const base = { source: INFO, query: { country: "CA", product: asked, ...(area === NATIONAL ? {} : { market: area }) }, measure: "median" as const, currency: "CAD", unit: "per kg", method: METHOD, baseUrl: q.baseUrl };
  const here = snap.byArea.get(area) ?? new Map<string, DailyRow>();
  const allCommodities = [...(snap.byArea.get(NATIONAL)?.keys() ?? [])].sort();
  const found = matchCommodities([...here.keys()], asked);
  if (!found.length) {
    const msg =
      area !== NATIONAL && matchCommodities(allCommodities, asked).length
        ? `AAFC has fewer than ${MIN_QUOTES} usable quotes for '${asked}' at the ${area} wholesale centre in the week of ${snap.date}; leave market out to see all centres together.`
        : `No Canadian wholesale price for '${asked}' with ${MIN_QUOTES} or more weighed quotes in the week of ${snap.date}. Commodities we hold: ${allCommodities.map(title).join(", ")}.`;
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: msg };
  }
  // Several commodities match (for example 'beans'): the one with most quotes is the headline, the others are listed.
  const ranked = found.map((c) => here.get(c)!).sort((a, b) => b.n - a.n || a.item.localeCompare(b.item));
  const top = ranked[0];
  const centreRows = area === NATIONAL
    ? centres.flatMap((c) => {
        const r = snap.byArea.get(c)?.get(top.item);
        return r ? [{ centre: c, median_cad_per_kg: r.median, low_cad_per_kg: r.low, high_cad_per_kg: r.high, quotes: r.n }] : [];
      })
    : [];
  const where = area === NATIONAL ? "Canada's western wholesale centres (Calgary, Edmonton, Vancouver and Winnipeg)" : `the ${area} wholesale centre`;
  const lb = (v: number) => v * 0.45359237;
  return buildStatisticAnswer({
    ...base,
    query: { ...base.query, commodity: top.item },
    value: top.median,
    low: top.low,
    high: top.high,
    min: top.min,
    max: top.max,
    sample_size: top.n,
    period: { from: snap.date, to: snap.date },
    reference_period: snap.date,
    describe: (x) =>
      `Wholesalers quoted ${top.item} at a median of ${money(x)} per kg (about ${money(lb(x))} per lb) in ${where} for the week of ${snap.date}, ` +
      `from ${money(top.low)} to ${money(top.high)} per kg across ${top.n} quotes (10th to 90th percentile).`,
    note:
      "These are wholesalers' asking prices to retail buyers, not what was paid and not shop prices. The range spreads across varieties, grades, origins and package sizes quoted that week; " +
      "quotes that do not state a package weight are not included.",
    extra: {
      commodity: top.item,
      week: snap.date,
      price_basis: "asking (quoted) wholesale price, middle of the low and high quote",
      quotes: top.n,
      sample_is: "quotes (one per variety, grade, origin and package), not sales",
      cad_per_lb: { median: round3(lb(top.median)), low: round3(lb(top.low)), high: round3(lb(top.high)) },
      ...(centreRows.length ? { by_centre: centreRows } : {}),
      ...(ranked.length > 1 ? { other_matching_commodities: ranked.slice(1).map((r) => ({ commodity: r.item, median_cad_per_kg: r.median, quotes: r.n })) } : {}),
    },
  });
}

// ---------- the request ----------

export async function caAafc(q: CaQuery): Promise<PriceAnswer> {
  if (!q.product?.trim()) throw new InputError("product is required, for example 'apples', 'carrots', 'bananas' or 'cauliflower'.");
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice has not collected the AAFC weekly wholesale prices yet; data appears after the next daily collection.");
  return caAafcAnswer(snapshotOf(day), q);
}
