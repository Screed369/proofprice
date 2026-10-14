// Farm and wholesale food prices for 26 EU member states, from the European Commission's Agri-food data portal API
// (https://api.tech.ec.europa.eu/agrifood/api/...): weekly prices (raw milk: monthly) that Member States report to the Commission for
// cereals, beef, pig and lamb carcasses, poultry meat, eggs, raw milk, dairy products, olive oil and fruit and vegetables.
// Format checked live on 2026-10-14 through the GitHub probe (see CLAUDE.md); no key, no sign-up, one small request per answer.
//
// What the API gives: for each Member State, week (or month) and product, one published price per market (cereals, olive oil), per stage of the
// supply chain (F&V, cereals) or per class (pigs, beef). It does not say how many trades stand behind a price, so every answer is an official
// statistic: value + measure "average", range fields null, sample_size null. Where a country reports several markets and no national average,
// we average the markets (unweighted) and say so; that is the only calculation besides percentage changes, per-kg conversion and 12-month figures.
//
// Quirks handled here (all seen in the live data): decimal comma in cereals ("€248,00") and decimal point elsewhere; a price of null or "€,00";
// Greece is "EL"; HTTP 404 with "No results found" means no data (not an error); the same week listed under two marketing years (olive oil);
// aggregate rows for "EU" and "EU+UK" (never used); poultry's unit label says "national currency" but the figures are euro-scale.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { resolveFetcher, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { Family, kgPerUnit, Product, resolveProduct, UNIT_TEXT, Variant } from "./products";

export const INFO: SourceInfo = {
  id: "eu-farm-prices",
  country: "EU member states (all except Luxembourg)",
  category: "farm-prices (farm and wholesale food prices)",
  name: "Agri-food data portal: agricultural market prices (cereals, beef, pigmeat, sheepmeat, poultry, eggs, raw milk, dairy, olive oil, fruit and vegetables)",
  publisher: "European Commission, DG Agriculture and Rural Development (Agri-food data portal)",
  what_is_recorded:
    "Prices of agricultural products that EU Member States report to the European Commission: for each country, week (raw milk: month) and product, " +
    "the price at a stated stage of the supply chain, for example cereals at important national markets (farm gate, ex-silo, delivered to port), " +
    "pig, beef and lamb carcasses by class, poultry meat, eggs by farming method, raw cow's milk and eight representative dairy products, olive oil by grade and market, " +
    "and fruit and vegetables at the farm gate, ex-packaging station and retail-buying stage. One published figure per cell; never individual trades, farms or buyers.",
  price_type: "official_statistic",
  freshness:
    "Weekly for most products (raw milk monthly), updated as Member States report, usually within days (raw milk about two weeks after the month ends). " +
    "Each answer states its week or month and flags quotes that are older than usual (fruit and vegetables are only quoted in season)",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0), under the Commission's reuse policy (Commission Decision of 12 December 2011 on the reuse of Commission documents): " +
    "reuse is allowed, provided appropriate credit is given and changes are indicated",
  licence_url: "https://commission.europa.eu/legal-notice_en",
  // The Commission asks for "appropriate credit" and for changes to be indicated; it publishes no fixed attribution text for this data, so this is ours.
  attribution:
    "Source: European Commission, DG Agriculture and Rural Development, Agri-food data portal (https://agridata.ec.europa.eu), © European Union, " +
    "licensed under CC BY 4.0 (https://commission.europa.eu/legal-notice_en). Prices are passed on as published by the Member States; changes by ProofPrice: " +
    "the average of several markets where no national average is published, percentage changes, prices per kilogram, and the 12-month figures.",
  homepage: "https://agridata.ec.europa.eu/extensions/DataPortal/agricultural_markets.html",
  limits:
    "Prices reported by national authorities for a stated week or month and stage of the supply chain (farm gate, ex-packaging station, ex-silo, carcass price, wholesale), " +
    "not what shoppers pay in a shop and not an asking price; fruit and vegetable stage 'retail selling price' is a shelf price and is only shown when nothing else exists. " +
    "Definitions differ between countries (markets, grades, what the price includes), so levels are not strictly comparable across borders. " +
    "No distribution and no number of trades is published, so there is no range and no sample size. Where several markets are reported and no national average exists we show their simple, unweighted average. " +
    "Every price carries the euro sign; for poultry the portal labels the unit 'national currency' but the figures are euro-scale (Poland's whole chicken is about 160 to 190 per 100 kg, the EU about 290), so we treat them as euro. " +
    "Luxembourg is not covered by the portal. Not every country reports every product (olive oil: ES, IT, PT, GR, HR only). The portal rate-limits heavy use.",
};

/** ISO 3166 alpha-2 -> name for every country the portal holds prices for (GR is the portal's EL). Union of all sectors, checked 2026-10-14. */
export const COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia", FI: "Finland",
  FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia", LT: "Lithuania", MT: "Malta",
  NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania", SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
};

export const API_BASE = "https://api.tech.ec.europa.eu/agrifood/api";
/** Days of history asked for: a year plus a margin, so the year-earlier price is in the same response. */
export const WINDOW_DAYS = 460;
const WINDOW_MONTHS = 15;

/** One endpoint per sector. */
const ENDPOINT: Record<Family, string> = {
  cereal: "cereal/prices",
  beef: "beef/prices",
  pig: "pigmeat/prices",
  sheep: "sheepAndGoat/prices",
  poultry: "poultry/prices",
  egg: "poultry/egg/prices",
  milk: "rawMilk/prices",
  dairy: "dairy/prices",
  oliveoil: "oliveOil/prices",
  fruitveg: "fruitAndVegetable/pricesSupplyChain",
};

/** The API's own filter parameter per sector. Only parameters verified live on 2026-10-14; sheep and poultry are small and filtered here. */
const FILTER_PARAM: Partial<Record<Family, string>> = {
  cereal: "productCodes",
  beef: "productCodes",
  pig: "pigClasses",
  egg: "farmingMethods",
  milk: "products",
  dairy: "products",
  oliveoil: "products",
  fruitveg: "products",
};

/** Which row fields hold the variant (product, class...), the market and the supply-chain stage. */
const FIELDS: Record<Family, { variant: string; market?: string; stage?: string }> = {
  cereal: { variant: "productName", market: "marketName", stage: "stageName" },
  beef: { variant: "productCode" },
  pig: { variant: "pigClass" },
  sheep: { variant: "category", market: "marketName" },
  poultry: { variant: "productName", stage: "priceType" },
  egg: { variant: "farmingMethod" },
  milk: { variant: "product" },
  dairy: { variant: "product" },
  oliveoil: { variant: "product", market: "market" },
  fruitveg: { variant: "variety", market: "market", stage: "productStage" },
};

/** Preferred order of the supply-chain stages (prefixes, lower case). */
const STAGE_ORDER: Partial<Record<Family, string[]>> = {
  fruitveg: ["ex-packaging", "farmgate", "retail buying", "retail selling"],
  poultry: ["selling price", "non-retail buying", "retail buying"],
  cereal: [
    "national average", "price at farm gate", "departure from farm", "departure from silo", "deliver to first customer", "delivered to processor",
    "delivered to port", "delivered to a port", "rendu port", "shipped to the place", "free on board", "cost, insurance",
  ],
};

// ---------- pure parsing ----------

/** "€168.20" -> 168.2, "€248,00" -> 248, "€,00" / null / "" -> null. A price of zero is "no price". */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[€\s ]/g, "");
  if (!s) return null;
  const comma = s.includes(","), dot = s.includes(".");
  if (comma && dot) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma) s = s.replace(",", ".");
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** "28/09/2026" -> "2026-09-28"; anything else -> null. */
export function parseDate(raw: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DAY = 86400000;
const dayNo = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const fmtMonth = (iso: string) => `${MONTHS_LONG[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const eur = (v: number, d = 2) => `€${v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const perKgText = (v: number) => (v < 1 ? eur(v, 3) : eur(v, 2));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- quotes ----------

export interface Quote {
  begin: string; // ISO date
  end: string; // ISO date, last day of the week or month
  value: number; // as published
  variantIdx: number;
  raw: string; // the variant text in the row
  market: string | null;
  stage: string | null;
}

/** The F&V row's variety is "<product> - <variety>" (or with an en dash); this keeps "Apples ..." from matching "Apples for processing ...". */
function ownsVariety(raw: string, product: Product): boolean {
  const name = product.filter?.[0];
  return !!name && new RegExp(`^${escapeRe(name)}\\s+[-–—]\\s+`, "i").test(raw);
}

/** API rows -> quotes of this product in this country. Skips rows with no price, other countries, other products and repeated rows. */
export function toQuotes(rows: unknown, product: Product, geo: string): Quote[] {
  if (!Array.isArray(rows)) return [];
  const f = FIELDS[product.family];
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (String(row.memberStateCode ?? "").toUpperCase() !== geo) continue;
    const value = parsePrice(row.price);
    const begin = parseDate(row.beginDate);
    const end = parseDate(row.endDate);
    if (value === null || !begin || !end) continue;
    const raw = String(row[f.variant] ?? "").trim();
    if (!raw) continue;
    if (product.family === "fruitveg" && !ownsVariety(raw, product)) continue;
    const variantIdx = product.variants.findIndex((v) => v.match(raw));
    if (variantIdx < 0) continue;
    const market = f.market ? String(row[f.market] ?? "").trim() || null : null;
    const stage = f.stage ? String(row[f.stage] ?? "").trim() || null : null;
    const key = [variantIdx, raw, market, stage, end].join("|"); // olive oil lists the same week under two marketing years
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ begin, end, value, variantIdx, raw, market, stage });
  }
  return out;
}

// ---------- choosing the series (pure) ----------

export interface Period {
  begin: string;
  end: string;
  value: number;
  /** Quotes averaged into the value (markets, or varieties); 1 when the portal publishes the figure directly. */
  n: number;
}

export interface MarketBasis {
  mode: "national" | "single" | "average" | "none";
  names: string[];
}

export interface Pick {
  variantIdx: number;
  stage: string | null;
  markets: MarketBasis;
  periods: Period[]; // oldest first
  raws: string[]; // distinct variety texts behind the figure
}

const isMonthly = (family: Family) => family === "milk";
const freshDays = (family: Family) => (isMonthly(family) ? 45 : 28);
const isNationalMarket = (m: string) => /national|average/i.test(m) || /^all$/i.test(m);

function stageRank(family: Family, stage: string): number {
  const order = STAGE_ORDER[family] ?? [];
  const s = stage.toLowerCase();
  const i = order.findIndex((p) => s.startsWith(p));
  return i < 0 ? 99 : i;
}

/** The first variant, in the product's order of preference, whose newest quote is within a few weeks of the newest quote of any variant. */
export function chooseVariant(quotes: Quote[], product: Product): number | null {
  const last = new Map<number, number>();
  for (const q of quotes) last.set(q.variantIdx, Math.max(last.get(q.variantIdx) ?? -Infinity, dayNo(q.end)));
  if (!last.size) return null;
  const freshest = Math.max(...last.values());
  for (let i = 0; i < product.variants.length; i++) {
    const l = last.get(i);
    if (l !== undefined && l >= freshest - freshDays(product.family)) return i;
  }
  return null;
}

/** For one variant: choose the supply-chain stage and the markets, then give one value per week (or month). */
export function seriesFor(all: Quote[], product: Product, variantIdx: number, forceStage?: string | null): Pick | null {
  const mine = all.filter((q) => q.variantIdx === variantIdx);
  if (!mine.length) return null;
  const tol = freshDays(product.family);

  // stage
  let stage: string | null = null;
  const stages = [...new Set(mine.map((q) => q.stage).filter((s): s is string => !!s))];
  let inStage = mine;
  if (stages.length) {
    if (forceStage !== undefined && forceStage !== null && stages.includes(forceStage)) {
      stage = forceStage;
    } else {
      const newest = Math.max(...mine.map((q) => dayNo(q.end)));
      const fresh = stages
        .map((s) => {
          const qs = mine.filter((q) => q.stage === s && dayNo(q.end) >= newest - tol);
          return { s, markets: new Set(qs.map((q) => q.market)).size, n: qs.length };
        })
        .filter((c) => c.n > 0);
      const pool = fresh.length ? fresh : stages.map((s) => ({ s, markets: 0, n: 0 }));
      if (product.family === "cereal") {
        // a published national average first, then the stage most markets quote, then the order of preference
        pool.sort((a, b) => {
          const an = /^national average/i.test(a.s) ? 0 : 1, bn = /^national average/i.test(b.s) ? 0 : 1;
          return an - bn || b.markets - a.markets || stageRank(product.family, a.s) - stageRank(product.family, b.s);
        });
      } else {
        pool.sort((a, b) => stageRank(product.family, a.s) - stageRank(product.family, b.s) || b.n - a.n);
      }
      stage = pool[0].s;
    }
    inStage = mine.filter((q) => q.stage === stage);
  }

  // markets
  const names = [...new Set(inStage.map((q) => q.market).filter((m): m is string => !!m))];
  let used = inStage;
  let markets: MarketBasis = { mode: "none", names: [] };
  if (names.length) {
    const newest = Math.max(...inStage.map((q) => dayNo(q.end)));
    const national = names.filter(isNationalMarket);
    const nationalQuotes = inStage.filter((q) => q.market !== null && national.includes(q.market));
    if (national.length && nationalQuotes.length && Math.max(...nationalQuotes.map((q) => dayNo(q.end))) >= newest - tol) {
      used = nationalQuotes;
      markets = { mode: "national", names: national };
    } else if (names.length === 1) {
      markets = { mode: "single", names };
    } else {
      markets = { mode: "average", names };
    }
  }

  // one value per period
  const byEnd = new Map<string, Quote[]>();
  for (const q of used) byEnd.set(q.end, [...(byEnd.get(q.end) ?? []), q]);
  const periods: Period[] = [...byEnd.entries()]
    .map(([end, qs]) => ({
      begin: qs.map((q) => q.begin).sort()[0],
      end,
      value: roundTo(qs.reduce((s, q) => s + q.value, 0) / qs.length, 2), // prices have two decimals; so does an average of them
      n: qs.length,
    }))
    .sort((a, b) => (a.end < b.end ? -1 : 1));
  return { variantIdx, stage, markets, periods, raws: [...new Set(used.map((q) => q.raw))] };
}

// ---------- the reading (pure) ----------

export interface Compared {
  begin: string;
  end: string;
  value: number;
  change_percent: number;
}

export interface FarmReading {
  product: Product;
  country: string;
  countryName: string;
  variantIdx: number;
  variant: Variant;
  /** "only": the product has one series; "preferred": the first of several; "fallback": the preferred one has no recent price. */
  variantChoice: "only" | "preferred" | "fallback";
  stage: string | null;
  markets: MarketBasis;
  raws: string[];
  monthly: boolean;
  latest: Period;
  previous: Compared | null;
  yearAgo: Compared | null;
  last12: { from: string; to: string; periods: number; min: number; max: number; average: number };
  series: Period[]; // up to the last 12, oldest first
  otherSeries: Array<{ id: string; label: string; stage: string | null; end: string; value: number }>;
  otherStages: Array<{ stage: string; end: string; value: number }>;
}

export interface FarmMiss {
  reason: "no_rows" | "no_variant";
  seen: string[]; // what the portal does hold for this country in the response (variant texts)
}

export function isFarmReading(x: FarmReading | FarmMiss | null): x is FarmReading {
  return !!x && "latest" in x;
}

function compare(latest: Period, other: Period | undefined): Compared | null {
  if (!other || other.value <= 0) return null;
  return { begin: other.begin, end: other.end, value: other.value, change_percent: roundTo(((latest.value - other.value) / other.value) * 100, 1) };
}

export function readFarm(rows: unknown, q: { product: Product; country: string; geo: string }): FarmReading | FarmMiss {
  const { product } = q;
  const quotes = toQuotes(rows, product, q.geo);
  if (!quotes.length) {
    const f = FIELDS[product.family];
    const seen = Array.isArray(rows)
      ? [...new Set((rows as Array<Record<string, unknown>>).filter((r) => r && String(r.memberStateCode ?? "").toUpperCase() === q.geo).map((r) => String(r[f.variant] ?? "").trim()).filter(Boolean))]
      : [];
    return { reason: seen.length ? "no_variant" : "no_rows", seen: seen.slice(0, 30) };
  }
  const idx = chooseVariant(quotes, product)!;
  const pick = seriesFor(quotes, product, idx)!;
  const monthly = isMonthly(product.family);
  const latest = pick.periods[pick.periods.length - 1];
  const latestDay = dayNo(latest.end);

  const before = pick.periods.filter((p) => p.end < latest.end);
  const prev = before[before.length - 1];
  const previous = prev && latestDay - dayNo(prev.end) <= (monthly ? 45 : 10) ? compare(latest, prev) : null;

  const target = latestDay - 365;
  const tol = monthly ? 20 : 7;
  const ago = pick.periods
    .filter((p) => p.end < latest.end && Math.abs(dayNo(p.end) - target) <= tol)
    .sort((a, b) => Math.abs(dayNo(a.end) - target) - Math.abs(dayNo(b.end) - target))[0];
  const yearAgo = compare(latest, ago);

  const year = pick.periods.filter((p) => dayNo(p.end) > latestDay - 366);
  const values = year.map((p) => p.value);
  const last12 = {
    from: year[0].begin,
    to: latest.end,
    periods: year.length,
    min: Math.min(...values),
    max: Math.max(...values),
    average: roundTo(values.reduce((s, v) => s + v, 0) / values.length, 2),
  };

  const otherSeries: FarmReading["otherSeries"] = [];
  const otherStages: FarmReading["otherStages"] = [];
  if (product.family === "fruitveg") {
    const stages = [...new Set(quotes.filter((x) => x.variantIdx === idx).map((x) => x.stage).filter((s): s is string => !!s && s !== pick.stage))];
    for (const s of stages) {
      const o = seriesFor(quotes, product, idx, s);
      const lp = o?.periods[o.periods.length - 1];
      if (o && lp && o.stage === s) otherStages.push({ stage: s, end: lp.end, value: lp.value });
    }
  } else {
    for (let i = 0; i < product.variants.length; i++) {
      if (i === idx) continue;
      const o = seriesFor(quotes, product, i);
      const lp = o?.periods[o.periods.length - 1];
      if (o && lp) otherSeries.push({ id: product.variants[i].id, label: product.variants[i].label || product.name, stage: o.stage, end: lp.end, value: lp.value });
    }
  }

  return {
    product,
    country: q.country,
    countryName: COUNTRIES[q.country] ?? q.country,
    variantIdx: idx,
    variant: product.variants[idx],
    variantChoice: product.variants.length === 1 || product.family === "fruitveg" ? "only" : idx === 0 ? "preferred" : "fallback",
    stage: pick.stage,
    markets: pick.markets,
    raws: pick.raws,
    monthly,
    latest,
    previous,
    yearAgo,
    last12,
    series: pick.periods.slice(-12),
    otherSeries: otherSeries.slice(0, 10),
    otherStages,
  };
}

// ---------- age (pure) ----------

export function ageOf(endISO: string, now: Date, monthly: boolean): { days: number; level: "current" | "older" | "old"; sentence: string } {
  const today = Math.floor(now.getTime() / DAY);
  const days = Math.max(0, today - dayNo(endISO));
  const limits = monthly ? { current: 75, older: 130 } : { current: 21, older: 56 };
  if (days <= limits.current) return { days, level: "current", sentence: "" };
  if (days <= limits.older) {
    return { days, level: "older", sentence: `The latest quote is ${days} days old, older than usual for this series.` };
  }
  const span = monthly ? `${Math.round(days / 30)} months` : `${Math.round(days / 7)} weeks`;
  return {
    days,
    level: "old",
    sentence: `WARNING: the newest quote the portal holds is from ${fmtDay(endISO)}, about ${span} ago. The series may have stopped or be out of season: do not use it as a current price.`,
  };
}

// ---------- words (pure) ----------

const STAGE_SHORT: Array<[RegExp, string]> = [
  [/^national average/i, "national average"],
  [/farm ?gate/i, "farm-gate"],
  [/ex-packaging/i, "ex-packaging station"],
  [/retail buying/i, "price retailers pay"],
  [/retail selling/i, "retail shelf price"],
  [/departure from farm|from production area/i, "leaving the farm"],
  [/departure from silo/i, "ex-silo"],
  [/first customer/i, "delivered to the first buyer"],
  [/delivered to (a )?port|rendu port|shipped to the place/i, "delivered to port"],
  [/delivered to processor/i, "delivered to a processor"],
  [/free on board/i, "free on board (export)"],
  [/cost, insurance/i, "cost, insurance and freight"],
];
export function stageShort(stage: string): string {
  return STAGE_SHORT.find(([re]) => re.test(stage))?.[1] ?? stage.toLowerCase();
}

function changePhrase(c: Compared | null, what: string): string | null {
  if (!c) return null;
  if (c.change_percent === 0) return `unchanged from ${what}`;
  return `${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${what}`;
}

function periodWords(r: { monthly: boolean; latest: Period }): string {
  return r.monthly ? fmtMonth(r.latest.end) : `the week ${fmtDay(r.latest.begin)} to ${fmtDay(r.latest.end)}`;
}

function referencePeriod(r: { monthly: boolean; latest: Period }): string {
  return r.monthly ? r.latest.end.slice(0, 7) : `${r.latest.begin} to ${r.latest.end}`;
}

// ---------- the answer (pure) ----------

export function farmAnswer(
  result: FarmReading | FarmMiss | null,
  q: { country: string; product: Product; baseUrl?: string; apiUrl?: string; now?: Date },
): PriceAnswer {
  const now = q.now ?? new Date();
  const p = q.product;
  const unit = UNIT_TEXT[p.unit];
  const countryName = COUNTRIES[q.country] ?? q.country;
  const query = { country: q.country, product: p.key };
  const method =
    "The European Commission's Agri-food data portal publishes the prices Member States report for each week (raw milk: month), product and stage of the supply chain. " +
    "ProofPrice returns the latest published figure for the country and product, unchanged where the portal gives a national figure; where it gives only several markets we show their simple average. " +
    "With it come the previous period, the same period a year earlier, the last 12 months and the other series the portal holds. No range is calculated: the portal gives one price per cell and does not say how many trades are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit, method, baseUrl: q.baseUrl };

  if (!isFarmReading(result)) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const miss = result ?? { reason: "no_rows" as const, seen: [] };
    const summary =
      miss.reason === "no_variant"
        ? `The Agri-food data portal has ${p.group.split(" (")[0].toLowerCase()} prices for ${countryName} but none for ${p.name}: it holds ${miss.seen.join(", ")}.`
        : `The Agri-food data portal holds no ${p.name} price for ${countryName} in the last ${WINDOW_MONTHS} months. Not every country reports every product, and fruit and vegetables are only quoted in season.`;
    return {
      ...none,
      summary,
      extra: {
        country_name: countryName,
        product: { key: p.key, name: p.name, group: p.group },
        ...(miss.seen.length ? { reported_series: miss.seen } : {}),
        ...(q.apiUrl ? { portal_api_url: q.apiUrl } : {}),
      },
    };
  }

  const r = result;
  const age = ageOf(r.latest.end, now, r.monthly);
  const kg = kgPerUnit(p.unit);
  const phrase = r.variant.label || p.name;
  const detail: string[] = [];
  if (r.stage && r.product.family !== "poultry") detail.push(stageShort(r.stage));
  if (r.markets.mode === "national" && !(r.stage && /^national average/i.test(r.stage))) detail.push("national average");
  else if (r.markets.mode === "average") detail.push(`simple average of ${r.markets.names.length} markets`);
  const what = detail.length ? `${phrase} (${detail.join(", ")})` : phrase;

  const prevText = changePhrase(r.previous, r.monthly ? "the previous month" : "the previous week");
  const agoText = changePhrase(r.yearAgo, "a year earlier");
  const changes = [prevText, agoText].filter(Boolean);

  const notes: string[] = [];
  if (r.variantChoice === "preferred") notes.push(`${p.key} has several series; ${phrase} is shown (the others are in extra.other_series).`);
  if (r.variantChoice === "fallback") notes.push(`The usual series for ${p.key} has no recent price in ${countryName}, so ${phrase} is shown (see extra.other_series).`);
  if (r.markets.mode === "average") notes.push(`${countryName} reports ${r.markets.names.length} markets and no national average here: the figure is their simple, unweighted average.`);
  if (r.product.family === "fruitveg" && r.raws.length > 1) notes.push(`The portal gives no all-varieties figure at this stage, so the figure is the simple average of ${r.raws.length} varieties: ${r.raws.slice(0, 6).join("; ")}.`);
  if (r.product.family === "poultry") notes.push("The portal labels poultry prices 'national currency/100kg' but the figures are euro-scale; they are treated as euro.");
  if (r.stage && r.product.family === "fruitveg" && /retail selling/i.test(r.stage)) notes.push("This is a retail shelf price, the only stage the portal holds for this product here.");
  if (age.sentence) notes.push(age.sentence);

  const extra: Record<string, unknown> = {
    country_name: countryName,
    product: { key: p.key, name: p.name, group: p.group, series: { id: r.variant.id, label: phrase, chosen_by: r.variantChoice === "only" ? "only series" : r.variantChoice === "preferred" ? "default" : "fallback" } },
    published_unit: unit,
    ...(kg ? { price_per_kg: roundTo(r.latest.value / kg, 4) } : {}),
    reference: { kind: r.monthly ? "month" : "week", from: r.latest.begin, to: r.latest.end },
    basis: {
      ...(r.stage ? { stage: r.stage, stage_short: stageShort(r.stage) } : {}),
      markets: { mode: r.markets.mode, count: r.markets.names.length, names: r.markets.names.slice(0, 12) },
      quotes_averaged: r.latest.n,
      ...(r.product.family === "fruitveg" ? { varieties: r.raws.slice(0, 12) } : {}),
    },
    data_age: { days_old: age.days, level: age.level, note: age.sentence || `This is the latest ${r.monthly ? "month" : "week"} the portal holds for this series.` },
    previous_period: r.previous,
    year_earlier: r.yearAgo,
    last_12_months: { ...r.last12, vs_average_percent: roundTo(((r.latest.value - r.last12.average) / r.last12.average) * 100, 1) },
    recent_series: r.series.map((s) => ({ from: s.begin, to: s.end, value: s.value })),
    ...(r.otherSeries.length ? { other_series: r.otherSeries.map((o) => ({ series: o.id, label: o.label, ...(o.stage ? { stage: o.stage } : {}), period_to: o.end, value: o.value })) } : {}),
    ...(r.otherStages.length ? { other_stages: r.otherStages.map((o) => ({ stage: o.stage, stage_short: stageShort(o.stage), period_to: o.end, value: o.value })) } : {}),
    ...(q.apiUrl ? { portal_api_url: q.apiUrl } : {}),
  };

  const answer = buildStatisticAnswer({
    ...base,
    value: r.latest.value,
    period: { from: r.latest.begin, to: r.latest.end },
    reference_period: referencePeriod(r),
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${countryName} the latest published price for ${what} was ${eur(v)} ${unit}${kg ? ` (${perKgText(v / kg)} per kg)` : ""} for ${periodWords(r)}.` +
      (changes.length ? ` That is ${changes.join(" and ")}.` : "") +
      (age.sentence ? ` ${age.sentence}` : ""),
    extra,
  });
  // A quote that is older than usual is not "high confidence" as a current price, whatever the publisher's own reliability.
  return age.level === "current" ? answer : { ...answer, confidence: age.level === "older" ? "medium" : "low" };
}

// ---------- the request ----------

const enc = (v: string) => encodeURIComponent(v).replace(/%2F/gi, "/").replace(/%2C/gi, ",");
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** The one request for a product in a country: its sector's endpoint, filtered to the country and the product's codes, for the last WINDOW_DAYS days. */
export function farmUrl(product: Product, geo: string, now: Date): string {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const begin = new Date(end.getTime() - WINDOW_DAYS * DAY);
  const parts = [`memberStateCodes=${geo}`];
  const param = FILTER_PARAM[product.family];
  if (param && product.filter?.length) parts.push(`${param}=${product.filter.map(enc).join(",")}`);
  parts.push(`beginDate=${ddmmyyyy(begin)}`, `endDate=${ddmmyyyy(end)}`);
  return `${API_BASE}/${ENDPOINT[product.family]}?${parts.join("&")}`;
}

/** Rows from the portal. HTTP 404 "No results found" is how it says "nothing matches": that is no data, not a failure. */
async function fetchRows(url: string, o: FetchOptions): Promise<unknown[]> {
  try {
    const body = await resolveFetcher(o)(url);
    if (Array.isArray(body)) return body;
    throw new SourceError("The Agri-food data portal returned an unexpected answer", JSON.stringify(body)?.slice(0, 300));
  } catch (err) {
    if (err instanceof SourceError) {
      if (/HTTP 404/.test(err.message) && /no (results|data)/i.test(err.detail ?? "")) return [];
      if (/HTTP 429/.test(err.message)) {
        throw new SourceError("The Agri-food data portal is limiting requests at the moment; try again in a minute", err.detail);
      }
    }
    throw err;
  }
}

export async function euFarmPrices(
  input: { country: string; product?: string; baseUrl?: string; now?: Date },
  o: FetchOptions = {},
): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`Farm and wholesale food prices are available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const product = resolveProduct(input.product);
  const now = input.now ?? new Date();
  const geo = toEurostatGeo(country);
  const url = farmUrl(product, geo, now);
  const rows = await fetchRows(url, o);
  const result = readFarm(rows, { product, country, geo });
  return farmAnswer(result, { country, product, baseUrl: input.baseUrl, apiUrl: url, now });
}
