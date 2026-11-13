// Detroit, Michigan home sales from the City of Detroit Assessor's property sales table (ArcGIS FeatureServer on Detroit Open Data).
// Fields and values checked live on 2026-11-13 from the workspace (see fixtures in source.test.ts). We ask for the sale date, price and ZIP only:
// never the address, parcel number, grantor or grantee. The view holds some future-dated and $1 rows, so we filter hard.
// Gotchas: sale_date is a date-only field (compare with a plain 'YYYY-MM-DD' string); orderByFields works with ObjectId or sale_date.

import { arcgisAll, arcgisQuery, Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";

export const LAYER = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/assessor_property_sales_view/FeatureServer/0";

export const INFO: SourceInfo = {
  id: "us-detroit-home-sales",
  country: "US (Detroit, Michigan)",
  category: "home sales",
  name: "Detroit Assessor property sales",
  publisher: "City of Detroit, Office of the Assessor, published on Detroit Open Data",
  what_is_recorded: "Recorded property sales: sale date, sale price, terms of sale, property class and ZIP code. No addresses, parcel numbers or names are read.",
  price_type: "transaction",
  freshness: "Updated by the Assessor; the newest sales are usually days to a few weeks old",
  licence:
    "No licence stated on the dataset record (CKAN license 'No License Provided'); the portal says data is 'provided freely and under an open license' without naming one. Free tier only until a human clears it",
  licence_url: "https://detroitdata.org/dataset/property-sales1",
  attribution: "Source: City of Detroit, Office of the Assessor, property sales (Detroit Open Data). Figures are ProofPrice aggregates of the published sale records.",
  homepage: "https://detroitdata.org/dataset/property-sales1",
  limits:
    "Detroit city only. Improved residential parcels (class RESIDENTIAL; vacant lots, commercial and industrial excluded), arm's-length sales ('03-ARM'S LENGTH') of $10,000 or more. " +
    "Multi-parcel, family, foreclosure, government and other non-market transfers are excluded. Aggregates only, never addresses, parcel numbers or names.",
};

export const MIN_SALE = 10_000;
export const MAX_ROWS = 20_000;
export const PAGE_SIZE = 1_000;
export const FIELDS = ["sale_date", "amt_sale_price", "zip_code"];

// ---------- is this request about Detroit? ----------

function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const MI = new Set(["mi", "michigan"]);
/** Detroit ZIP codes run 48201-48288 (plus a few 482xx PO boxes). */
const DETROIT_ZIP = /^482\d{2}(?:-\d{4})?$/;

/** True for 'Detroit' (no state), 'Detroit, MI', state MI with town Detroit, or a 482xx ZIP with no town. Other states' Detroits are not served. */
export function isDetroitRequest(p: { town?: unknown; state?: unknown; postcode?: unknown }): boolean {
  const state = p.state === undefined || p.state === null ? "" : normName(String(p.state));
  const town = p.town === undefined || p.town === null ? "" : String(p.town);
  if (town.trim()) {
    const parts = town.split(",");
    if (normName(parts[0]) !== "detroit") return false;
    const q = parts[1] ? normName(parts[1]) : state;
    return q === "" || MI.has(q);
  }
  if (state && !MI.has(state)) return false;
  const zip = p.postcode === undefined || p.postcode === null ? "" : String(p.postcode).trim();
  return DETROIT_ZIP.test(zip);
}

// ---------- queries ----------

export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function clampMonths(months: number | undefined): number {
  return months === undefined || !Number.isFinite(months) ? 12 : Math.max(1, Math.min(36, Math.round(months)));
}

const BASE_WHERE = `term_of_sale='03-ARM''S LENGTH' AND property_class_description='RESIDENTIAL' AND amt_sale_price>=${MIN_SALE}`;

/** Window is from (exclusive) to (inclusive). 'to' also keeps out the future-dated rows in the view. */
export function buildWhere(window: { from: string; to: string }, zip?: string): string {
  let w = `${BASE_WHERE} AND sale_date > '${window.from}' AND sale_date <= '${window.to}'`;
  if (zip) w += ` AND zip_code='${zip}'`;
  return w;
}

export interface Sale { price: number; date: string; zip: string }

export function parseSales(rows: Record<string, any>[]): Sale[] {
  const out: Sale[] = [];
  for (const r of rows) {
    const price = Number(r.amt_sale_price);
    const date = typeof r.sale_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.sale_date) ? r.sale_date.slice(0, 10) : "";
    if (!Number.isFinite(price) || price < MIN_SALE || !date) continue;
    out.push({ price, date, zip: typeof r.zip_code === "string" ? r.zip_code.trim().slice(0, 5) : "" });
  }
  return out;
}

async function latestSale(today: string, fetcher?: Fetcher): Promise<string | null> {
  const r = await arcgisQuery(LAYER, { where: buildWhere({ from: "1990-01-01", to: today }), outFields: ["sale_date"], orderByFields: ["sale_date DESC"], resultRecordCount: 1 }, { fetcher, timeoutMs: 25000 });
  return parseSales(r.rows.map((x) => ({ sale_date: x.sale_date, amt_sale_price: MIN_SALE })))[0]?.date ?? null;
}

export interface DetroitInput { town?: string; postcode?: string; state?: string; months?: number; property_type?: string; baseUrl?: string }
export interface DetroitOptions { fetcher?: Fetcher; today?: Date }

export async function detroitHomeSales(input: DetroitInput, opts: DetroitOptions = {}): Promise<PriceAnswer> {
  const pt = (input.property_type ?? "any").toLowerCase();
  if (pt !== "any") throw new InputError("Detroit: property_type is not available (the City table mixes houses and condos). Leave it out.");
  const zip = input.postcode ? String(input.postcode).trim().slice(0, 5) : "";
  if (zip && !/^482\d{2}$/.test(zip)) throw new InputError("Detroit ZIP codes are 48201 to 48288.");
  const months = clampMonths(input.months);
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const latest = await latestSale(today, opts.fetcher);
  if (!latest) throw new SourceError("The Detroit property sales table returned no recent qualified sales");
  const window = { from: monthsBack(latest, months), to: latest };
  const c = await arcgisAll(LAYER, { where: buildWhere(window, zip || undefined), outFields: FIELDS, orderByFields: ["ObjectId ASC"] }, { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: PAGE_SIZE, timeoutMs: 25000 });
  const sales = parseSales(c.rows);
  const dates = sales.map((s) => s.date).sort();
  const summary = summarise(sales.map((s) => s.price));
  const area = zip ? `Detroit, MI ${zip}` : "Detroit, MI";
  return buildAnswer({
    source: INFO,
    query: { country: "US", town: input.town ?? null, state: "MI", postcode: zip || null, months },
    summary,
    currency: "USD",
    unit: "per sale",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of arm's-length sales of improved residential property in ${area} in the ${months} months up to the latest recorded sale (${latest}), ` +
      "from the City of Detroit Assessor's property sales table. Sales under $10,000, multi-parcel sales and non-market transfers (family, foreclosure, government, life estate) are excluded." +
      (c.truncated ? ` Only the first ${MAX_ROWS.toLocaleString("en-US")} sales are used.` : ""),
    describe: (x) => `Homes in ${area} sold for a median of ${fmtMoney(x.median, "USD")}; 10th–90th percentile range ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")}.`,
    baseUrl: input.baseUrl,
    extra: { area, dataset: { name: INFO.name, url: INFO.licence_url }, window: { months, from_exclusive: window.from, to: window.to }, dataset_latest_sale: latest },
  });
}

// ---------- daily collector (stale-if-error copy) ----------
export const HARVEST_AREA = "DETROIT";
export const HARVEST_ITEM = "sales-12m/any";

export function detroitHistoryKey(p: { town?: string; postcode?: string; months?: number; property_type?: string }): { area: string; item: string; label: string } | null {
  if (p.postcode && String(p.postcode).trim()) return null;
  if (p.months !== undefined && p.months !== null && p.months !== 12) return null;
  if (p.property_type && p.property_type.toLowerCase() !== "any") return null;
  return { area: HARVEST_AREA, item: HARVEST_ITEM, label: "Detroit, MI" };
}

export function harvestFrom(sales: Sale[], date: string): HarvestResult | null {
  const s = summarise(sales.map((x) => x.price));
  if (!s || s.count < MIN_PUBLISH) return null;
  return {
    date,
    currency: "USD",
    unit: "per sale",
    rows: [{ area: HARVEST_AREA, item: HARVEST_ITEM, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max }],
    note: "Detroit arm's-length improved residential sales of $10,000 or more in the 12 months up to the newest recorded sale, from the City Assessor table. Aggregates only.",
  };
}

export async function detroitHarvest(opts: DetroitOptions = {}): Promise<HarvestResult> {
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const latest = await latestSale(today, opts.fetcher);
  if (!latest) throw new SourceError("The Detroit property sales table returned no recent qualified sales");
  const c = await arcgisAll(LAYER, { where: buildWhere({ from: monthsBack(latest, 12), to: latest }), outFields: FIELDS, orderByFields: ["ObjectId ASC"] }, { fetcher: opts.fetcher, maxRows: MAX_ROWS, pageSize: PAGE_SIZE, timeoutMs: 25000 });
  const res = harvestFrom(parseSales(c.rows), today);
  if (!res) throw new SourceError("The Detroit table holds fewer than 5 qualified sales in the newest 12 months");
  return res;
}
