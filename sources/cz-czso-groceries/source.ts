// Czechia: monthly average consumer prices of selected food and drink products, from the Czech Statistical Office (CZSO / CSU),
// table CEN0101NT01 "Prumerne spotrebitelske ceny vybranych druhu zbozi - od 2026" (average prices, from scanner data, CZK).
// Key-free JSON-stat 2.0 API, checked live on 2026-11-11 (workspace GET, 18 KB):
//   https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101NT01
// Format: dimensions [IndicatorType(1), Uz0(1, "CZ"), CENREP4(86 products, codes like 01142001), CasM(10 months "2026-01".."2026-10")];
// one flat `value` list, the month varies fastest; `updated` = "2026-11-10T08:00Z". The unit of each product is the bracket at the
// end of its Czech label ("[1 kg]", "[1 l]", "[10 ks]", "[100 g]", "[0,75 l]"). National only. Licence: CC BY 4.0 (CZSO conditions of use).
// CZSO publishes an average and does not say how many price records stand behind it: an official statistic, NO_COUNT, no range.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { parseJsonStat, JsonStatTable } from "../../lib/adapters";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { exampleWords, ItemDef, matchItem } from "../../categories/groceries/items";
import { ITEMS } from "./items";

export { ITEMS };

export const API_URL = "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101NT01";

export const INFO: SourceInfo = {
  id: "cz-czso-groceries",
  country: "CZ (Czechia)",
  category: "groceries (monthly average consumer prices of selected food and drink products)",
  name: "Average consumer prices of selected goods, from scanner data (CZSO table CEN0101NT01)",
  publisher: "Czech Statistical Office (CZSO, Cesky statisticky urad)",
  what_is_recorded:
    "For about 86 food and drink products (a named cut, pack or variety), the national average consumer price per month in CZK, " +
    "computed by CZSO from retail scanner data. One published average per product and month; never an individual shop or receipt.",
  price_type: "official_statistic",
  freshness: "Monthly: newest month published 10 November 2026 (October 2026), about 10 days after the month ends",
  licence: "CC BY 4.0 (CZSO conditions for use: statistical information released through csu.gov.cz is licensed under CC BY 4.0). Figures are passed on as published.",
  licence_url: "https://csu.gov.cz/conditions_for_use_and_further_dissemination",
  attribution: "Source: Czech Statistical Office (CZSO), Average consumer prices of selected goods, csu.gov.cz. CC BY 4.0. Figures are passed on as published; ProofPrice adds no calculation.",
  homepage: "https://csu.gov.cz/produkty/average-prices-survey-of-selected-products-food-and-beverages-time-series",
  limits:
    "National averages only (no regions, no single shops). Scanner-data averages for a defined product, not receipts. CZSO does not say how many price records stand behind an average, so no range or sample size is given.",
};

// ---------- reading the table (pure) ----------

export interface MonthValue {
  /** "YYYY-MM" */
  month: string;
  price: number;
}

export interface CzTable {
  title: string;
  updated: string | null;
  /** All months in the table, oldest first. */
  months: string[];
  /** CZSO product code -> Czech name and its monthly values, oldest first. */
  products: Map<string, { name: string; series: MonthValue[] }>;
}

/** Parse the CZSO JSON-stat response. Fails loudly (SourceError) when the layout is not the one we checked. */
export function parseCz(json: unknown): CzTable {
  const t: JsonStatTable = parseJsonStat(json);
  if (!t.ids.includes("CENREP4") || !t.ids.includes("CasM")) throw new SourceError("The CZSO price table has changed shape: product or month dimension missing.");
  const months = t.codes.CasM;
  if (!months.length || !months.every((m) => /^\d{4}-\d{2}$/.test(m))) throw new SourceError("The CZSO price table has changed shape: months are not YYYY-MM.");
  const products = new Map<string, { name: string; series: MonthValue[] }>();
  for (const row of t.rows) {
    const code = String(row.CENREP4);
    const month = String(row.CasM);
    const value = row.value;
    if (value === null || !(value > 0)) continue;
    let p = products.get(code);
    if (!p) products.set(code, (p = { name: t.labels.CENREP4?.[code] ?? code, series: [] }));
    p.series.push({ month, price: value });
  }
  for (const p of products.values()) p.series.sort((a, b) => a.month.localeCompare(b.month));
  if (products.size < 40) throw new SourceError("The CZSO price table has changed shape: too few products were found.");
  return { title: t.label ?? "", updated: t.updated, months: [...months].sort(), products };
}

export interface CzReading {
  code: string;
  czechName: string;
  series: MonthValue[];
  latest: MonthValue;
  tableLatestMonth: string;
  updated: string | null;
  /** Set when read from our daily copy (YYYY-MM-DD the copy is dated). */
  copyDate?: string;
}

export function readProduct(t: CzTable, code: string): CzReading | null {
  const p = t.products.get(code);
  if (!p || !p.series.length) return null;
  return { code, czechName: p.name, series: p.series, latest: p.series[p.series.length - 1], tableLatestMonth: t.months[t.months.length - 1], updated: t.updated };
}

// ---------- the answer (pure) ----------

const czk = (v: number) => `${v.toFixed(2)} CZK`;
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function czMethod(): string {
  return (
    "The Czech Statistical Office (CZSO) publishes, every month, the national average consumer price of about 86 defined food and drink products, computed from retail scanner data (table CEN0101NT01). " +
    "ProofPrice returns the published average for the product's latest month, unchanged, and the published averages of the earlier months of the table. " +
    "No range is calculated: CZSO gives one average and does not say how many price records are behind it. These are statistical averages for a defined product, not receipts and not the price at any one shop."
  );
}

export interface CzQuery {
  item: string;
  region?: string;
  baseUrl?: string;
}

const CZ_WORDS = new Set(["cz", "cze", "czechia", "czech republic", "national", "nationwide", "all", "whole country"]);

export function czAnswer(reading: CzReading | null, def: ItemDef | null, related: ItemDef[], q: CzQuery): PriceAnswer {
  const query: Record<string, unknown> = { country: "CZ", item: q.item, ...(q.region ? { region: q.region } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "CZK", method: czMethod(), baseUrl: q.baseUrl };
  const regionNote =
    q.region && !CZ_WORDS.has(q.region.trim().toLowerCase())
      ? `CZSO publishes national averages only, so the region "${q.region}" was ignored and the figure is the average for the whole of Czechia.`
      : undefined;

  if (!def || !reading) {
    const none = buildStatisticAnswer({ ...base, value: null, unit: def?.unit ?? "", period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const hint = def ? `The CZSO table holds no price for "${def.label}".` : `The CZSO table has no product matching "${q.item}".`;
    return { ...none, summary: `${hint} Try one of: ${exampleWords(ITEMS, 24).join(", ")}.`, extra: { available_items: exampleWords(ITEMS, 60), ...(regionNote ? { region_note: regionNote } : {}) } };
  }

  const r = reading;
  const m = r.latest.month;
  const notes: string[] = [];
  if (r.latest.month < r.tableLatestMonth) notes.push(`CZSO has no price for this product in ${r.tableLatestMonth}; this is its latest available month.`);
  if (regionNote) notes.push(regionNote);

  const extra: Record<string, unknown> = {
    country_name: "Czechia",
    item: { definition: def.label, unit: def.unit, czso_code: r.code, czso_name: r.czechName, asked_for: q.item },
    what_this_is: "National average consumer price of this defined product in the month, from CZSO retail scanner data. Not a receipt and not the price at any one shop.",
    reference_month: m,
    published_by_month: r.series.slice(-12).map((s) => ({ month: s.month, average_price_czk: s.price })),
    other_definitions: related.map((d) => ({ item: d.words[0], definition: d.label, unit: d.unit })),
    ...(r.copyDate ? { read_from: "ProofPrice's daily copy of the CZSO table", copy_dated: r.copyDate } : {}),
    dataset: { code: "CEN0101NT01", title: "Average consumer prices of selected goods, from 2026", updated: r.updated, latest_month_in_table: r.tableLatestMonth, url: INFO.homepage },
    ...(regionNote ? { region_note: regionNote } : {}),
  };

  return buildStatisticAnswer({
    ...base,
    value: r.latest.price,
    unit: def.unit,
    period: { from: `${m}-01`, to: monthEnd(m) },
    reference_period: m,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) => `In Czechia the average consumer price of "${def.label}" was ${czk(v)} ${def.unit} in ${m} (CZSO scanner-data average; not a receipt or the price at one shop).`,
    extra,
  });
}

export const NATIONAL_AREA = "ALL";

// ---------- the request ----------

export interface CzOptions {
  /** Replace the download (tests): returns the parsed JSON. */
  loader?: () => Promise<unknown>;
  timeoutMs?: number;
  /** Replace the library read (tests). */
  libraryReader?: () => { date: string; rows: { area: string; item: string; median: number }[] } | null;
}

async function download(timeoutMs: number): Promise<unknown> {
  return fetchJson(API_URL, { headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com; hello@proofprice.com)" } }, timeoutMs);
}

export async function czGroceries(input: CzQuery, o: CzOptions = {}): Promise<PriceAnswer> {
  const item = input.item?.trim();
  if (!item) throw new InputError("item is required: an everyday food such as 'milk', 'bread' or 'eggs'.");
  const m = matchItem(ITEMS, item);
  if (!m.primary) return czAnswer(null, null, [], input);
  const table = parseCz(await (o.loader ? o.loader() : download(o.timeoutMs ?? 20000)));
  return czAnswer(readProduct(table, m.primary.code), m.primary, m.related, input);
}

// ---------- daily copy (stale-if-error and history) ----------
// The collector reads the table once a day and stores the newest month of every mapped product (n is NO_COUNT, dated by the last
// day of the reference month), so history builds month by month and a CZSO outage is answered from the copy.

export function harvestRows(t: CzTable): HarvestResult {
  const readings = ITEMS.map((def) => ({ def, r: readProduct(t, def.code) })).filter((x): x is { def: ItemDef; r: CzReading } => !!x.r);
  if (!readings.length) throw new SourceError("The CZSO table held no price for any mapped product");
  const month = readings.map((x) => x.r.latest.month).sort().pop()!;
  const rows = readings
    .filter((x) => x.r.latest.month === month)
    .map((x) => {
      const v = x.r.latest.price;
      return { area: NATIONAL_AREA, item: x.def.label, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: monthEnd(month),
    currency: "CZK",
    unit: "per kg, litre, piece or pack (named in the item)",
    rows,
    note: `CZSO CEN0101NT01: national average consumer prices for ${month}, ${rows.length} products. Published averages, no record count.`,
  };
}

export async function czHarvest(o: CzOptions & { sleep?: (ms: number) => Promise<void> } = {}): Promise<HarvestResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return harvestRows(parseCz(await (o.loader ? o.loader() : download(o.timeoutMs ?? 30000))));
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(5000 * attempt);
    }
  }
  throw last;
}

export function czHistoryKey(p: { item?: string }): { area: string; item: string; label: string } | null {
  const def = matchItem(ITEMS, p.item ?? "").primary;
  return def ? { area: NATIONAL_AREA, item: def.label, label: "Czechia" } : null;
}

