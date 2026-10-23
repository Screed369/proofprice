// United States: USDA Agricultural Marketing Service (AMS) Livestock Mandatory Price Reporting, read from the key-free LMPRS API
// (https://mpr.datamart.ams.usda.gov/services/v1.1/reports). Format checked through the GitHub probe on 2026-10-23 (see source.test.ts).
// Report LM_CT154 = slug 2481, "National Weekly Direct Slaughter Cattle - Negotiated Purchases", one report date per week (a Monday).
// GET .../reports/2481/Detail?q=report_date=MM/DD/YYYY:MM/DD/YYYY;class_description=STEER;selling_basis_description=LIVE%20FOB
// returns { results: [ { report_date, class_description (STEER|HEIFER), source_description (Domestic|Imported),
//   selling_basis_description (LIVE FOB|DRESSED FOB|...), purchase_type_code (NEGOTIATED CASH|...), grade_description,
//   head_count "34,701", weight_range_avg "1,592", price_range_low, price_range_high, weighted_avg_price "224.37" (USD per cwt) } ] }.
// Rows with no trade have every number null. Without a q the API returns the whole history (1.8 MB): always send a date range.
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";

export const API = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports";
export const REPORT_SLUG = 2481;
export const ATTRIBUTION_LINE = "Source: USDA Agricultural Marketing Service, Livestock Mandatory Reporting (LM_CT154)";

export const INFO: SourceInfo = {
  id: "us-ams-livestock",
  country: "US (United States)",
  category: "wholesale fresh food (fed cattle sold to packers, negotiated purchases)",
  name: "National Weekly Direct Slaughter Cattle, negotiated purchases (USDA AMS, LM_CT154)",
  publisher: "USDA Agricultural Marketing Service (AMS), Livestock Mandatory Price Reporting",
  what_is_recorded:
    "Each week, the head-weighted average price that US meat packers paid for fed steers and heifers bought on negotiated cash terms (live weight FOB feedlot, and dressed weight FOB plant), by quality grade, with the number of head bought. Packers report these purchases to USDA by law; USDA publishes only the totals, never one sale or one buyer.",
  price_type: "transaction",
  freshness: "Weekly, published on Monday for the week just ended; every answer states the report date",
  licence: "CC0 1.0 (public domain dedication; data.gov record 'Livestock and Grain Market News LMR Web Services', publisher USDA AMS)",
  licence_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: ATTRIBUTION_LINE,
  homepage: "https://mpr.datamart.ams.usda.gov/",
  limits:
    "A weekly average of negotiated cash purchases only (formula, forward-contract and negotiated-grid purchases are other reports and are not included). Domestic cattle only. US dollars per hundredweight (100 pounds, live or dressed as the answer says). Not the price of a particular animal, farm or sale, not a futures price and not a retail beef price.",
};

export interface Product {
  key: string;
  desc: string;
  cls: "STEER" | "HEIFER";
  basis: "LIVE FOB" | "DRESSED FOB";
  words: string[];
}
const P = (key: string, desc: string, cls: Product["cls"], basis: Product["basis"], words: string): Product => ({ key, desc, cls, basis, words: words.split("|").map((w) => w.trim()) });

export const PRODUCTS: Product[] = [
  P("steer-live", "Fed steers, live weight", "STEER", "LIVE FOB", "cattle|fed cattle|slaughter cattle|steer|steers|live cattle|beef cattle|live steers|fed steers"),
  P("heifer-live", "Fed heifers, live weight", "HEIFER", "LIVE FOB", "heifer|heifers|live heifers|fed heifers"),
  P("steer-dressed", "Fed steers, dressed weight", "STEER", "DRESSED FOB", "dressed steers|dressed steer|dressed cattle|carcass cattle|steers dressed"),
  P("heifer-dressed", "Fed heifers, dressed weight", "HEIFER", "DRESSED FOB", "dressed heifers|dressed heifer|heifers dressed"),
];

const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export const exampleProducts = () => "cattle, steers, heifers, dressed steers, dressed heifers";

export function matchProduct(query: string): Product | null {
  const q = plain(query);
  if (!q) return null;
  const hit = (w: string) => PRODUCTS.find((p) => p.words.map(plain).includes(w));
  return hit(q) ?? (q.endsWith("s") ? hit(q.slice(0, -1)) : hit(`${q}s`)) ?? null;
}

// ---------- parsing ----------

export interface Week {
  date: string; // ISO yyyy-mm-dd
  head: number;
  value: number; // USD per cwt, head-weighted
  grades: { grade: string; head: number; value: number; low: number | null; high: number | null; weight: number | null }[];
}

const num = (s: unknown): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isoFromUs = (d: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
const usFromIso = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Pure: the report weeks in a /Detail reply for one product, oldest first. Keeps Domestic NEGOTIATED CASH rows of the product's class and
 *  selling basis that have a head count and a weighted average price; a week's figure is the head-weighted mean of its grade rows.
 *  A week with fewer than 5 head is dropped. */
export function parseDetail(json: any, product: Product): Week[] {
  const rows = Array.isArray(json?.results) ? json.results : null;
  if (!rows) throw new SourceError("USDA AMS returned an unexpected reply (no results list); this source needs updating.");
  const byDate = new Map<string, Week["grades"]>();
  for (const r of rows) {
    if (String(r.class_description ?? "").toUpperCase() !== product.cls) continue;
    if (String(r.selling_basis_description ?? "").toUpperCase() !== product.basis) continue;
    if (String(r.purchase_type_code ?? "").toUpperCase() !== "NEGOTIATED CASH") continue;
    if (String(r.source_description ?? "").toUpperCase() !== "DOMESTIC") continue;
    const date = isoFromUs(String(r.report_date ?? ""));
    const head = num(r.head_count);
    const value = num(r.weighted_avg_price);
    if (!date || head === null || value === null || head <= 0 || value <= 0) continue;
    const list = byDate.get(date) ?? [];
    list.push({ grade: String(r.grade_description ?? ""), head, value, low: num(r.price_range_low), high: num(r.price_range_high), weight: num(r.weight_range_avg) });
    byDate.set(date, list);
  }
  const out: Week[] = [];
  for (const [date, grades] of byDate) {
    const head = grades.reduce((s, g) => s + g.head, 0);
    if (head < 5) continue;
    const value = Math.round((grades.reduce((s, g) => s + g.head * g.value, 0) / head) * 100) / 100;
    out.push({ date, head, value, grades });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- fetching ----------

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86400000);

export type Getter = (url: string) => Promise<any>;
const get: Getter = (url) => fetchJson(url, {}, 25000);

/** Reports are weekly: a 14-day window holds the newest week and the one before it (and still has one if a Monday is a week late). */
export function detailUrl(product: Product, today: Date, days = 14): string {
  const q = `report_date=${usFromIso(isoDay(daysBefore(today, days)))}:${usFromIso(isoDay(today))};class_description=${product.cls};selling_basis_description=${encodeURIComponent(product.basis)}`;
  return `${API}/${REPORT_SLUG}/Detail?q=${q}`;
}

export async function readWeeks(product: Product, today: Date, getter: Getter = get, days = 14): Promise<Week[]> {
  return parseDetail(await getter(detailUrl(product, today, days)), product);
}

// ---------- the answer ----------

const monthDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildCattleAnswer(product: Product, weeks: Week[], q: { product: string; region?: string }, today: Date, baseUrl?: string): PriceAnswer {
  const latest = weeks[weeks.length - 1];
  if (!latest) throw new SourceError(`USDA AMS holds no negotiated ${product.desc.toLowerCase()} report for the last two weeks.`);
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const change = prev ? { reference_date: prev.date, value: prev.value, change_percent: r1(((latest.value - prev.value) / prev.value) * 100) } : null;
  const age = Math.round((today.getTime() - new Date(`${latest.date}T00:00:00Z`).getTime()) / 86400000);
  const basisWords = product.basis === "LIVE FOB" ? "live weight, FOB the feedlot" : "dressed (carcass) weight, FOB the packing plant";
  const notes = [
    "USDA's weekly head-weighted average of negotiated cash purchases by packers; not one animal, not a futures price and not a retail beef price.",
    ...(q.region ? [`USDA publishes this as a national figure here, so the region "${q.region}" was not used; the answer is national.`] : []),
    ...(age > 14 ? [`Old data: the newest weekly report USDA holds for this product is ${age} days old.`] : []),
  ];
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "US", product: q.product, ...(q.region ? { region: q.region } : {}) },
    value: latest.value,
    measure: "average",
    currency: "USD",
    unit: "per hundredweight (100 lb)",
    period: { from: latest.date, to: latest.date },
    reference_period: latest.date,
    sample_size: latest.head,
    method:
      "USDA AMS Livestock Mandatory Price Reporting, report LM_CT154: packers report the cattle they bought on negotiated cash terms in the week; USDA publishes the head count and weighted average price by quality grade. " +
      `We pass on the newest weekly report for ${product.desc.toLowerCase()} (${basisWords}), combining the grades as a head-weighted mean, Domestic cattle only. The sample size is head of cattle bought, not sales records. No range is calculated.`,
    note: notes.join(" "),
    baseUrl,
    ending: `${ATTRIBUTION_LINE}.`,
    evidence: { label: "Published market average", meaning: "A weighted average of prices packers paid, calculated and published by USDA AMS; the sample size is the number of head of cattle bought." },
    describe: () =>
      `US packers paid an average of US$${latest.value.toFixed(2)} per hundredweight for ${product.desc.split(",")[0].toLowerCase()} (${basisWords}) on negotiated cash terms in the week reported on ${monthDay(latest.date)}` +
      ` (${latest.head.toLocaleString("en-US")} head), as published by USDA AMS.` +
      (change ? ` That is ${change.change_percent === 0 ? "unchanged" : `${Math.abs(change.change_percent)}% ${change.change_percent > 0 ? "higher" : "lower"}`} than the week reported on ${monthDay(change.reference_date)}.` : ""),
    extra: {
      country_name: "United States",
      product: { key: product.key, name: product.desc, class: product.cls, selling_basis: product.basis, asked_for: q.product },
      usd_per_cwt: latest.value,
      usd_per_lb: Math.round(latest.value) / 100,
      head_bought: latest.head,
      report_date: latest.date,
      change_on_previous_week: change,
      by_grade: latest.grades.map((g) => ({ grade: g.grade, head: g.head, usd_per_cwt: g.value, low: g.low, high: g.high, average_weight_lb: g.weight })),
      what_this_is: "Weekly head-weighted average of negotiated cash prices that US packers paid for fed cattle, published by USDA AMS (LM_CT154). Not one animal, not a futures price and not a retail price.",
      attribution_notice: ATTRIBUTION_LINE,
    },
  });
}

export async function usLivestock(input: { product: string; region?: string; today?: Date; baseUrl?: string }, getter: Getter = get): Promise<PriceAnswer> {
  const text = input.product?.trim();
  if (!text) throw new InputError(`product is required: cattle in everyday words such as ${exampleProducts()}.`);
  const product = matchProduct(text);
  if (!product) throw new InputError(`United States: no USDA fed-cattle series matches "${text}". Try one of: ${exampleProducts()}.`);
  const today = input.today ?? new Date();
  return buildCattleAnswer(product, await readWeeks(product, today, getter), { product: text, region: input.region?.trim() || undefined }, today, input.baseUrl);
}

// ---------- daily copy (stale-if-error and history) ----------

export const livestockItem = (p: Product) => `${p.desc} (USD per cwt)`;

/** Pure: one library row per product, dated by the newest report week any product has; a product whose own newest week is older is left out. */
export function harvestRows(all: { product: Product; weeks: Week[] }[]): HarvestResult {
  const latest = all.filter((a) => a.weeks.length).map((a) => ({ product: a.product, w: a.weeks[a.weeks.length - 1] }));
  if (!latest.length) throw new SourceError("USDA AMS returned no usable fed-cattle report");
  const date = latest.map((l) => l.w.date).sort().pop()!;
  const kept = latest.filter((l) => l.w.date === date);
  return {
    date,
    currency: "USD",
    unit: "per hundredweight (100 lb)",
    rows: kept.map((l) => ({ area: "United States", item: livestockItem(l.product), n: l.w.head, median: l.w.value, low: l.w.value, high: l.w.value, min: l.w.value, max: l.w.value })),
    note: "USDA AMS LM_CT154 weekly negotiated cash purchases of fed cattle: head-weighted average price by product in US dollars per hundredweight; n is head of cattle bought.",
  };
}

export async function livestockHarvest(today: Date = new Date(), getter: Getter = get): Promise<HarvestResult> {
  const all: { product: Product; weeks: Week[] }[] = [];
  for (const product of PRODUCTS) all.push({ product, weeks: await readWeeks(product, today, getter, 21) });
  return harvestRows(all);
}

export function livestockHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const product = matchProduct(p.product ?? "");
  return product ? { area: "United States", item: livestockItem(product), label: product.desc } : null;
}
