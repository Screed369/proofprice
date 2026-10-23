// Finland farm-gate prices from Luke (Natural Resources Institute Finland), "Producer prices" statistics on its PxWeb database
// (https://statdb.luke.fi/PxWeb/api/v1/en/LUKE/maa/tuohin/kk/): monthly prices paid to Finnish producers for meat (table 0200),
// milk (0100) and eggs (0300). Table metadata (GET) checked live 2026-10-23 from GitHub's servers (see meta-*.json). The data itself is a POST of an
// item selection that we ask for in PxWeb's native "json" format ({columns, data:[{key, values}]}), which every PxWeb v1 server offers.
// Luke publishes one price per month and series, with no count of farms or deliveries: every answer is an official statistic.
// Which products are ours: the keys below are product keys of sources/eu-farm-prices; for FI those products go here (a declared serves() change in
// eu-farm-prices) and everything else (piglets, dairy products, fruit and vegetables, cereals ...) stays with the European Commission portal.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { resolveFetcher } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { resolveProduct } from "../eu-farm-prices/products";

export const INFO: SourceInfo = {
  id: "fi-luke-farm-prices",
  country: "FI (Finland)",
  category: "farm-prices (producer prices of meat, milk and eggs)",
  name: "Producer prices of meat, milk and eggs, monthly (Natural Resources Institute Finland, Luke, tables 0200, 0100 and 0300)",
  publisher: "Natural Resources Institute Finland (Luke)",
  what_is_recorded:
    "The monthly average price paid to Finnish producers for beef (cows, bulls, heifers, young bulls, calves, all cattle), fattening pigs, lamb, broilers, eggs (all classes, by production method) and raw milk. " +
    "One published figure per product and month; never individual farms, deliveries or buyers.",
  price_type: "official_statistic",
  freshness: "Monthly; the newest month in the tables on 23 Oct 2026 was August 2026 (published about two months later)",
  licence:
    "Luke: statistics are open data under the Creative Commons Attribution 4.0 International licence (CC BY 4.0): the data \"can also be merged with other data and used for commercial and non-commercial purposes\" " +
    "(exception: other producers' data, marked in the table's About menu).",
  licence_url: "https://www.luke.fi/en/statistics/about-statistics/terms-of-use-statistics",
  attribution:
    "Source: Natural Resources Institute Finland (Luke), producer prices of meat, milk and eggs (https://www.luke.fi/en/statistics), " +
    "licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Figures are passed on as published; ProofPrice adds the change on the previous month and a year earlier, and the price per kilogram.",
  homepage: "https://statdb.luke.fi/PxWeb/pxweb/en/LUKE/LUKE__02%20Maatalous__04%20Taloustilastot__02%20Tuottajahinnat/",
  limits:
    "A monthly average price paid to producers in Finland, not a sale, a retail price or a live price. Luke's table metadata does not say whether the meat price is per kilogram of carcass or whether VAT is included, " +
    "so the unit is given as Luke states it (EUR per 100 kg). No distribution and no number of trades is published, so there is no range and no sample size. " +
    "Luke's \"beef average\" and \"pork average\" series are weighted by Luke across the cattle or pig classes.",
};

export const LUKE_API = "https://statdb.luke.fi/PxWeb/api/v1/en/LUKE/maa/tuohin/kk";
export const tableUrl = (table: Table, base = LUKE_API) => `${base}/${table}_tuohin.px`;
export type Table = "0100" | "0200" | "0300";

/** One product we answer for. `key` is the product key of eu-farm-prices. `info` is the single value of the INFO variable (where the table has several); `series` the value of the species / class variable. */
export interface LukeProduct {
  key: string;
  table: Table;
  /** The variable that picks the series (null for milk, where INFO itself is the series). */
  seriesVar: "LJ" | "LLUOKK_TUOTT" | null;
  code: string;
  /** Noun phrase for sentences. */
  label: string;
  unit: "100kg" | "litre";
}

const p = (key: string, table: Table, seriesVar: LukeProduct["seriesVar"], code: string, label: string, unit: LukeProduct["unit"] = "100kg"): LukeProduct => ({ key, table, seriesVar, code, label, unit });

export const PRODUCTS: LukeProduct[] = [
  p("pig", "0200", "LJ", "LSIAT", "fattening pigs"),
  p("beef", "0200", "LJ", "NAUDL_KESKIM", "beef cattle (Luke's average of all cattle classes)"),
  p("young bull", "0200", "LJ", "NAUD812", "young bulls and heifers"),
  p("heifer", "0200", "LJ", "HIEH12KK", "heifers"),
  p("cow", "0200", "LJ", "LEHM", "cows"),
  p("calf", "0200", "LJ", "NAUD8", "calves"),
  p("lamb", "0200", "LJ", "KARI", "lamb"),
  p("chicken", "0200", "LJ", "BROI", "broilers"),
  p("eggs", "0300", "LLUOKK_TUOTT", "AB_KESKIM", "eggs (A- and B-class average)"),
  p("barn eggs", "0300", "LLUOKK_TUOTT", "A_LATT", "A-class barn eggs"),
  p("free range eggs", "0300", "LLUOKK_TUOTT", "A_ULKO", "A-class free-range eggs"),
  p("organic eggs", "0300", "LLUOKK_TUOTT", "A_LUOM", "A-class organic eggs"),
  p("cage eggs", "0300", "LLUOKK_TUOTT", "A_VIRI", "A-class eggs from enriched cages"),
  p("milk", "0100", null, "TUOHIN_KESKIM_CL", "raw milk (average producer price)", "litre"),
];
export const LUKE_KEYS: string[] = PRODUCTS.map((x) => x.key);

/** The product key behind a free-text product name, or null when it is not one of ours (then eu-farm-prices answers FI). */
export function lukeProductOf(raw: unknown): LukeProduct | null {
  try {
    const key = resolveProduct(typeof raw === "string" ? raw : String(raw ?? "")).key;
    return PRODUCTS.find((x) => x.key === key) ?? null;
  } catch {
    return null;
  }
}

// ---------- table metadata and the request ----------

export interface PxVariable { code: string; text: string; values: string[]; time: boolean }
export interface PxMeta { title: string; variables: PxVariable[] }

export function readMeta(json: unknown): PxMeta {
  const j = json as any;
  if (!j || typeof j !== "object" || !Array.isArray(j.variables)) throw new SourceError("Unexpected response from Luke (no table metadata)");
  return {
    title: String(j.title ?? ""),
    variables: j.variables.map((v: any) => ({
      code: String(v.code),
      text: String(v.text ?? ""),
      values: Array.isArray(v.values) ? v.values.map(String) : [],
      time: v.time === true,
    })),
  };
}

export interface PxQuery { query: Array<{ code: string; selection: { filter: "item"; values: string[] } }>; response: { format: "json" } }

/** Select the given series codes for the newest `months` months; every other variable (the single INFO value) is selected whole. */
export function requestFor(meta: PxMeta, prods: LukeProduct[], months: number): PxQuery {
  const time = meta.variables.find((v) => v.time);
  if (!time || !time.values.length) throw new SourceError("Luke changed its producer price tables (no month variable); this source needs updating.");
  const seriesVar = prods[0].seriesVar;
  const query = meta.variables.map((v) => {
    if (v.time) return { code: v.code, selection: { filter: "item" as const, values: v.values.slice(Math.max(0, v.values.length - months)) } };
    if (seriesVar && v.code === seriesVar) {
      for (const pr of prods) if (!v.values.includes(pr.code)) throw new SourceError(`Luke changed table ${pr.table}: series ${pr.code} is gone; this source needs updating.`);
      return { code: v.code, selection: { filter: "item" as const, values: prods.map((x) => x.code) } };
    }
    if (!seriesVar && v.code === "INFO") {
      for (const pr of prods) if (!v.values.includes(pr.code)) throw new SourceError(`Luke changed table ${pr.table}: ${pr.code} is gone; this source needs updating.`);
      return { code: v.code, selection: { filter: "item" as const, values: prods.map((x) => x.code) } };
    }
    return { code: v.code, selection: { filter: "item" as const, values: v.values } };
  });
  if (seriesVar && !meta.variables.some((v) => v.code === seriesVar)) throw new SourceError(`Luke changed table ${prods[0].table}: no ${seriesVar} variable; this source needs updating.`);
  return { query, response: { format: "json" } };
}

// ---------- reading the answer (pure) ----------

export interface Point { month: string; value: number }

/** PxWeb native "json" format: columns (dimensions first, then the content column "c") and data rows { key: [one value per dimension column], values: [...] }.
 *  Returns, per series code, its monthly points (oldest first); missing cells ("." ".." "-") are left out. */
export function readSeries(json: unknown, seriesVar: LukeProduct["seriesVar"], timeVar = "M"): Map<string, Point[]> {
  const j = json as any;
  if (!j || !Array.isArray(j.columns) || !Array.isArray(j.data)) throw new SourceError("Unexpected response from Luke (no data)");
  const dims: string[] = j.columns.filter((c: any) => c.type !== "c").map((c: any) => String(c.code));
  const iTime = dims.indexOf(timeVar);
  const iSeries = dims.indexOf(seriesVar ?? "INFO");
  if (iTime < 0 || iSeries < 0) throw new SourceError("Luke changed the layout of its producer price tables; this source needs updating.");
  const out = new Map<string, Point[]>();
  for (const row of j.data) {
    const key: string[] = Array.isArray(row.key) ? row.key.map(String) : [];
    const raw = Array.isArray(row.values) ? String(row.values[0] ?? "") : "";
    if (!/^-?\d/.test(raw)) continue;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const code = key[iSeries];
    if (!out.has(code)) out.set(code, []);
    out.get(code)!.push({ month: key[iTime], value });
  }
  for (const pts of out.values()) pts.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}

export function monthRange(m: string): { from: string; to: string } {
  const x = /^(\d{4})M(\d{2})$/.exec(m);
  if (!x || Number(x[2]) < 1 || Number(x[2]) > 12) throw new SourceError(`Unexpected month code from Luke: ${m}`);
  const y = Number(x[1]);
  const mm = Number(x[2]);
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${pad(mm)}-01`, to: `${y}-${pad(mm)}-${pad(last)}` };
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (m: string) => m.replace(/^(\d{4})M(\d{2})$/, (_, y, mm) => `${MONTH_NAMES[Number(mm) - 1]} ${y}`);
export function shiftMonth(m: string, delta: number): string {
  const x = /^(\d{4})M(\d{2})$/.exec(m)!;
  const idx = Number(x[1]) * 12 + (Number(x[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}M${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** The headline number in the unit we state: EUR per 100 kg as Luke publishes, or EUR per litre for milk (Luke: cents per litre). */
export const toHeadline = (pr: LukeProduct, v: number) => (pr.unit === "litre" ? v / 100 : v);
export const unitText = (pr: LukeProduct) => (pr.unit === "litre" ? "per litre" : "per 100 kg");
/** The library item for one product: its name and unit, so a stored copy reads on its own. */
export const itemName = (pr: LukeProduct) => `${pr.label} (EUR ${unitText(pr)})`;

const change = (now: number, then: number | undefined, month: string) =>
  then ? { reference_month: month, value: Number(then.toFixed(4)), change_percent: Math.round(((now - then) / then) * 1000) / 10 } : null;

export interface Ask { product: string; baseUrl?: string }

export function answerFor(pr: LukeProduct, pts: Point[], ask: Ask, now: Date = new Date()): PriceAnswer {
  const latest = pts.length ? pts[pts.length - 1] : null;
  const by = new Map(pts.map((x) => [x.month, x.value]));
  const base = { source: INFO, query: { country: "FI", product: pr.key }, measure: "average" as const, currency: "EUR", unit: unitText(pr), baseUrl: ask.baseUrl };
  if (!latest) {
    return buildStatisticAnswer({
      ...base, value: null, period: { from: null, to: null }, reference_period: "",
      method: "Finland (Luke producer prices): the latest monthly average price paid to producers.",
      describe: () => "",
      note: `Luke publishes no recent producer price for ${pr.label}.`,
    });
  }
  const head = toHeadline(pr, latest.value);
  const mom = change(latest.value, by.get(shiftMonth(latest.month, -1)), shiftMonth(latest.month, -1));
  const yoy = change(latest.value, by.get(shiftMonth(latest.month, -12)), shiftMonth(latest.month, -12));
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const [ly, lm] = latest.month.split("M").map(Number);
  const behind = nowIdx - (ly * 12 + (lm - 1));
  const notes = [`A monthly average price paid to Finnish producers for ${monthWords(latest.month)}, in the unit Luke states: not a sale, not a retail price and not a live price.`];
  if (pr.unit === "100kg") notes.push("Luke's table does not say whether the meat price is per kilogram of carcass or whether VAT is included.");
  if (behind >= 5) notes.push(`Old data: the newest month Luke holds is ${monthWords(latest.month)}, ${behind} months ago.`);
  const fmt = (v: number) => fmtMoney(v, "EUR");
  return buildStatisticAnswer({
    ...base,
    value: head,
    period: monthRange(latest.month),
    reference_period: latest.month,
    method:
      "Finland (Luke): the monthly average price paid to Finnish producers for the product, from Luke's producer price statistics. " +
      "We pass on the published average and its month, with the change on the previous month and a year earlier that we calculate from two published averages; it is a monthly average, not a sale, and no range is calculated.",
    describe: (v) =>
      `In ${monthWords(latest.month)} Finnish producers received on average ${fmt(v)} ${unitText(pr)} for ${pr.label}, as published by Luke (a monthly average, not a sale or a live price). ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier (${fmt(toHeadline(pr, yoy.value))} in ${monthWords(yoy.reference_month)}).`
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${fmt(toHeadline(pr, yoy.value))} in ${monthWords(yoy.reference_month)}).`
        : "Luke holds no price for the same month a year earlier."),
    note: notes.join(" "),
    extra: {
      country_name: "Finland",
      product: { definition: pr.label, asked_for: ask.product, luke_table: pr.table, luke_series: pr.code },
      what_this_is: "Monthly average price paid to producers in Finland, published by Luke. Not a sale, not a retail price and not a live price.",
      reference_month: latest.month,
      reference_month_label: monthWords(latest.month),
      published_value: latest.value,
      published_unit: pr.unit === "litre" ? "cents per litre" : "EUR per 100 kg",
      ...(pr.unit === "100kg" ? { price_per_kg: Number((latest.value / 100).toFixed(4)) } : {}),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      last_12_months: pts.filter((x) => x.month > shiftMonth(latest.month, -12)).map((x) => ({ month: x.month, value: Number(toHeadline(pr, x.value).toFixed(4)) })),
    },
  });
}

// ---------- the requests ----------

export interface LukeOptions extends FetchOptions {
  poster?: (url: string, body: unknown) => Promise<unknown>;
  apiBase?: string;
  now?: Date;
}
const poster = (o: LukeOptions) => o.poster ?? ((url: string, body: unknown) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, o.timeoutMs ?? 20000));

export async function lukeFarmPrices(input: { product?: string; baseUrl?: string }, o: LukeOptions = {}): Promise<PriceAnswer> {
  const pr = lukeProductOf(input.product);
  if (!pr) {
    throw new InputError(
      `For Finland, Luke publishes producer prices for these products: ${LUKE_KEYS.join(", ")}. "${input.product ?? ""}" is not one of them.`,
    );
  }
  const get = resolveFetcher(o);
  const url = tableUrl(pr.table, o.apiBase);
  const meta = readMeta(await get(url));
  const series = readSeries(await poster(o)(url, requestFor(meta, [pr], 14)), pr.seriesVar);
  return answerFor(pr, series.get(pr.code) ?? [], { product: String(input.product ?? ""), baseUrl: input.baseUrl }, o.now);
}

// ---------- daily copy (stale-if-error) ----------

/** Pure: one library row per product for the newest month any product has; products that lag behind it are left out. Each row is one published average (n is NO_COUNT). */
export function harvestRows(series: Array<{ pr: LukeProduct; points: Point[] }>): HarvestResult {
  const newest = series.filter((s) => s.points.length).map((s) => ({ pr: s.pr, last: s.points[s.points.length - 1] }));
  if (!newest.length) throw new SourceError("Luke returned no usable producer price");
  const month = newest.map((s) => s.last.month).sort().pop()!;
  const rows: DailyRow[] = newest
    .filter((s) => s.last.month === month)
    .map((s) => {
      const v = toHeadline(s.pr, s.last.value);
      return { area: "FI", item: itemName(s.pr), n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: monthRange(month).to,
    currency: "EUR",
    unit: "per 100 kg, or per litre for milk (the unit is in the product's name)",
    rows,
    note: `Luke producer prices for ${monthWords(month)}: published monthly averages paid to Finnish producers, not counts of sales (no count is published).`,
  };
}

export async function lukeHarvest(o: LukeOptions = {}): Promise<HarvestResult> {
  const get = resolveFetcher(o);
  const post = poster(o);
  const series: Array<{ pr: LukeProduct; points: Point[] }> = [];
  for (const table of ["0200", "0300", "0100"] as Table[]) {
    const prods = PRODUCTS.filter((x) => x.table === table);
    const url = tableUrl(table, o.apiBase);
    const meta = readMeta(await get(url));
    const got = readSeries(await post(url, requestFor(meta, prods, 3)), prods[0].seriesVar);
    for (const pr of prods) series.push({ pr, points: got.get(pr.code) ?? [] });
  }
  return harvestRows(series);
}

/** Where a request lives in the library, without asking Luke. */
export function lukeHistoryKey(p: { product?: string }): { area: string; item: string; label: string } | null {
  const pr = lukeProductOf(p.product);
  return pr ? { area: "FI", item: itemName(pr), label: `Finland, ${pr.label}` } : null;
}
