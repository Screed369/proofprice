// Allegheny County, Pennsylvania (Pittsburgh and 130 municipalities) home sales from the County Real Estate Division's "Property Sales
// Transactions", published by the Western Pennsylvania Regional Data Center (WPRDC) as a CKAN datastore, one table per sale year.
// Licence: CC0 1.0 (license_id cc-zero, read on package_show 2026-11-12). Bulk (about 24k rows a year) => the daily collector reads the
// newest three yearly tables through the CKAN adapter and stores aggregates only; requests are answered from the library.
// We read municipality, ZIP, sale date and price of rows marked SALEDESC = 'VALID SALE'. Never parcel ids, addresses or deed data.
// Format checked live on 2026-11-12 (see the fixtures in source.test.ts).

import { ckanAll, ckanPackage, Fetcher } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const SITE = "https://data.wprdc.org";
export const PACKAGE = "real-estate-sales";
export const HOMEPAGE = "https://data.wprdc.org/dataset/real-estate-sales";

export const INFO: SourceInfo = {
  id: "us-allegheny-home-sales",
  country: "US (Allegheny County, Pennsylvania only)",
  category: "home sales",
  name: "Property Sales Transactions, Allegheny County Real Estate Division (WPRDC)",
  publisher: "Allegheny County Real Estate Division, published by the Western Pennsylvania Regional Data Center (WPRDC)",
  what_is_recorded:
    "One row per recorded deed transfer of a parcel in Allegheny County (Pittsburgh area): sale date, price, municipality, ZIP and a validity code. " +
    "We read only the municipality, ZIP, sale date and price of sales the County codes 'VALID SALE'; never parcel numbers, addresses or deed books.",
  price_type: "transaction",
  freshness: "The County table is refreshed daily; sales appear after the deed is recorded. We collect it into our price library every day and each answer names the period it covers.",
  licence: "Creative Commons CC0 1.0 Universal (public-domain dedication), as stated on the WPRDC dataset record (license_id cc-zero)",
  licence_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution:
    "Source: Allegheny County Real Estate Division via the Western Pennsylvania Regional Data Center (CC0 1.0). Figures are ProofPrice aggregates (medians and percentiles of valid recorded sales). " +
    "The County notes that not every sale is recorded and that validation codes can change.",
  homepage: HOMEPAGE,
  limits:
    "Allegheny County, Pennsylvania only (not the rest of Pennsylvania). The table has no property type, so houses, condos and other parcels are mixed. " +
    "Only sales the County codes 'VALID SALE' with a price of $10,000 or more and under $10 million; family transfers, multi-parcel deals, sales not analysed and similar are left out. " +
    "A sale is dated by its sale date. Aggregates only, by municipality (Pittsburgh counted as one city) and ZIP code and a rolling window; never addresses or parcel numbers. Prices are the recorded deed amounts.",
  method_version: "1",
};

export const WINDOWS = [3, 6, 12, 24] as const;
export const ZIP_WINDOWS = [12, 24] as const;
export const MIN_PRICE = 10_000;
export const MAX_PRICE = 10_000_000; // exclusive
export const FIELDS = ["MUNIDESC", "PROPERTYZIP", "SALEDATE", "PRICE"];

export interface Sale { idx: number; day: string; muni: string; zip: string; price: number }

export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

/** "14th Ward - PITTSBURGH" -> "pittsburgh"; "Mt.Lebanon  " -> "mt-lebanon"; "O''Hara  " -> "o-hara". */
export function muniSlug(raw: string): string {
  if (/pittsburgh/i.test(raw)) return "pittsburgh";
  return slug(raw);
}

export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/** The yearly tables from package_show: names like "2026 Property Sales Transactions". Newest first. */
export function yearlyResources(resources: { id: string; name: string; datastoreActive: boolean }[]): { year: number; id: string }[] {
  const out: { year: number; id: string }[] = [];
  for (const r of resources) {
    const m = /^(\d{4}) Property Sales Transactions$/.exec(r.name.trim());
    if (m && r.datastoreActive && r.id) out.push({ year: Number(m[1]), id: r.id });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** Turn datastore rows into sales. Drops rows without a date or with a price outside the range. */
export function parseSales(rows: Record<string, any>[]): Sale[] {
  const out: Sale[] = [];
  for (const r of rows) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.SALEDATE ?? ""));
    const price = Number(r.PRICE);
    if (!m || !Number.isFinite(price) || price < MIN_PRICE || price >= MAX_PRICE) continue;
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    const zip = /^(\d{5})/.exec(String(r.PROPERTYZIP ?? "").trim())?.[1] ?? "";
    out.push({ idx: monthIndex(Number(m[1]), month), day: `${m[1]}-${m[2]}-${m[3]}`, muni: muniSlug(String(r.MUNIDESC ?? "")), zip, price });
  }
  return out;
}

/** Aggregates for every window ending at the newest sale date. Items: "<N>m" (USD per sale). Municipalities get 3/6/12/24 months, ZIP codes 12/24. */
export function dailyRows(sales: Sale[], today: string): { date: string; rows: DailyRow[]; last: string } {
  const valid = sales.filter((s) => s.day <= today);
  if (!valid.length) throw new SourceError("The Allegheny County sales tables held no usable valid sales");
  const last = valid.reduce((a, s) => (s.day > a ? s.day : a), "0000-00-00");
  const lastIdx = monthIndex(Number(last.slice(0, 4)), Number(last.slice(5, 7)));
  const muniRecs: { area: string; item: string; price: number }[] = [];
  const zipRecs: { area: string; item: string; price: number }[] = [];
  for (const s of valid) {
    const age = lastIdx - s.idx; // 0 = the month of the newest sale
    for (const m of WINDOWS) {
      if (age >= m) continue;
      if (s.muni) muniRecs.push({ area: s.muni, item: `${m}m`, price: s.price });
      if (s.zip && (ZIP_WINDOWS as readonly number[]).includes(m)) zipRecs.push({ area: `zip-${s.zip}`, item: `${m}m`, price: s.price });
    }
  }
  const rows = [...aggregateDaily(muniRecs, true), ...aggregateDaily(zipRecs, false)].filter((r) => r.n >= MIN_PUBLISH);
  return { date: last, rows, last };
}

// ---------- the daily collector ----------


export interface HarvestOptions { fetcher?: Fetcher; today?: Date }

export async function alleghenyHarvest(opts: HarvestOptions = {}): Promise<HarvestResult> {
  const now = opts.today ?? new Date();
  const pkg = await ckanPackage(SITE, PACKAGE, { fetcher: opts.fetcher });
  const tables = yearlyResources(pkg.resources).filter((t) => t.year <= now.getUTCFullYear() && t.year >= now.getUTCFullYear() - 2);
  if (!tables.length) throw new SourceError("The Allegheny County dataset lists no yearly sales tables");
  const sales: Sale[] = [];
  let read = 0;
  for (const t of tables) {
    const got = await ckanAll(
      SITE,
      { resourceId: t.id, filters: { SALEDESC: "VALID SALE" }, fields: FIELDS, sort: "_id asc", includeTotal: false },
      { fetcher: opts.fetcher, maxRows: 40_000, pageSize: 10_000, timeoutMs: 60_000 },
    );
    read += got.rows.length;
    sales.push(...parseSales(got.rows));
  }
  const { date, rows, last } = dailyRows(sales, now.toISOString().slice(0, 10));
  return {
    date,
    currency: "USD",
    unit: "per sale",
    rows,
    note: `Windows of 3/6/12/24 months ending ${last}; ${sales.length} valid sales of $10,000 or more kept of ${read} valid-sale rows read from ${tables.length} yearly tables.`,
  };
}

// ---------- the place ----------

const ZIP = /^\s*(15\d{3})(?:-\d{4})?\s*$/;
/** Allegheny County ZIP codes run 15001 to 15290. */
export const isAlleghenyZip = (z: string) => { const m = ZIP.exec(z); return !!m && Number(m[1]) >= 15001 && Number(m[1]) <= 15290; };
const ALLEGHENY_TOWNS = [
  "pittsburgh", "penn hills", "mt lebanon", "mount lebanon", "ross", "bethel park", "shaler", "mccandless", "monroeville", "plum", "moon",
  "upper st clair", "wilkinsburg", "west mifflin", "mckeesport", "bellevue", "carnegie", "coraopolis", "dormont", "mt oliver", "oakmont",
  "sewickley", "swissvale", "baldwin", "brentwood", "castle shannon", "cranberry", "etna", "forest hills", "homestead", "whitehall",
];
const STATE_WORDS = /\b(pa|pennsylvania|allegheny|allegheny county|county|usa|us|united states)\b/g;

/** Strip state and county words: "Pittsburgh, PA" -> "pittsburgh". */
export function cityText(town: string | undefined): string {
  return normaliseName(town ?? "").replace(STATE_WORDS, " ").replace(/\s+/g, " ").trim();
}

/** True when a US home-sales request is about Allegheny County: state PA, an Allegheny ZIP, 'Allegheny', or a well-known Allegheny town. */
export function isAlleghenyRequest(p: { town?: unknown; state?: unknown; postcode?: unknown }): boolean {
  const state = p.state === undefined || p.state === null ? "" : normaliseName(String(p.state));
  if (state) return state === "pa" || state === "pennsylvania";
  if (isAlleghenyZip(p.postcode === undefined || p.postcode === null ? "" : String(p.postcode))) return true;
  const raw = p.town === undefined || p.town === null ? "" : String(p.town);
  if (!raw.trim()) return false;
  const full = normaliseName(raw);
  if (/\b(pa|pennsylvania|allegheny)\b/.test(full)) return true;
  return ALLEGHENY_TOWNS.includes(cityText(raw));
}

/** Resolve a request to a library area. "" / "Allegheny County" = the county. */
export function resolveArea(p: { town?: string; postcode?: string }, known: string[]): { area: string; label: string } | null {
  const z = ZIP.exec(p.postcode ?? "");
  if (z) {
    const area = `zip-${z[1]}`;
    return known.length && !known.includes(area) ? null : { area, label: `ZIP ${z[1]}` };
  }
  const n = cityText(p.town);
  if (!n || n === "allegheny" ) return { area: NATIONAL, label: "Allegheny County" };
  const s = n.replace(/ /g, "-");
  const area = known.find((k) => k === s) ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", PA" };
}

export function alleghenyKey(p: { town?: string; postcode?: string; months?: number }, known: string[]) {
  const place = resolveArea(p, known);
  if (!place) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const set = place.area.startsWith("zip-") ? ZIP_WINDOWS : WINDOWS;
  const months = (set as readonly number[]).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, months, item: `${months}m` };
}

export function alleghenyHistoryKey(p: { town?: string; postcode?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = alleghenyKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Allegheny County` } : null;
}

// ---------- the answer ----------

const D = (v: number) => fmtMoney(v, "USD");

function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function alleghenyAnswerFromRow(row: DailyRow & { date: string }, q: { label: string; months: number; baseUrl?: string }): PriceAnswer {
  return buildAnswer({
    source: INFO,
    query: { country: "US", town: q.label, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "USD",
    unit: "per sale",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Allegheny County, Pennsylvania: median and 10th–90th percentile of the recorded sale price of parcels the County codes 'VALID SALE' (price of $10,000 or more and under $10 million) over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest; ZIP codes use 12 or 24) ending at the newest recorded sale. Property type is not in the table, so houses, condos and other parcels are mixed.",
    describe: (x) => `Valid recorded sales in ${q.label} had a median price of ${D(x.median)} (typical range ${D(x.low)} to ${D(x.high)}) over the last ${q.months} months.`,
    baseUrl: q.baseUrl,
    extra: { price_basis: "sale price on the recorded deed, County validity code 'VALID SALE'", property_type: "not available (all parcel types mixed)" },
  });
}

export async function alleghenyHomeSales(input: { town?: string; postcode?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  const k = alleghenyKey(input, known);
  if (!k) {
    const places = known.filter((a) => !a.startsWith("zip-")).slice(0, 40).join(", ");
    throw new InputError(`No figure for '${input.postcode || input.town}' in Allegheny County. Give a municipality such as Pittsburgh, Penn Hills, Mt Lebanon, Ross or Bethel Park, or a ZIP code (15xxx) with enough sales, or leave both out for the whole county. Places with enough sales: ${places}.`);
  }
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const pick = (item: string) => { const r = readDaily(INFO.id, { area: k.area, item, from, to }); return r[r.length - 1]; };
  const set = k.area.startsWith("zip-") ? ZIP_WINDOWS : WINDOWS;
  let row = pick(k.item), usedMonths = k.months, widened = false;
  if (!row || row.n < MIN_PUBLISH) {
    for (const m of set) {
      if (m <= k.months) continue;
      const r = pick(`${m}m`);
      if (r && r.n >= MIN_PUBLISH) { row = r; usedMonths = m; widened = true; break; }
    }
  }
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO, query: { country: "US", town: k.label, months: k.months },
      summary: null, currency: "USD", unit: "per sale", period: { from: null, to: null },
      method: "Rolling windows of the Allegheny County valid sales.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} valid sales in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} valid sales are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try a bigger place or leave town out for the whole county.`;
    return a;
  }
  const a = alleghenyAnswerFromRow(row, { label: k.label, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} valid sales in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
