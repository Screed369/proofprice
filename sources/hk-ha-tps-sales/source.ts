// Hong Kong public-housing sales from the Housing Authority's Tenants Purchase Scheme (TPS): one JSON file of sale
// transactions (data.gov.hk, "hk-housing-tpssale-tpssale"). These are REAL PAID PRICES, but of public rental flats sold to
// sitting tenants at a government DISCOUNT (discount_rate about 75 to 83 means the tenant paid that percent of the
// assessed value), so they are not market prices and are never presented as "the price of homes in Hong Kong".
// The file is about 80 MB, updated quarterly: a bulk file, so the daily collector (harvest) reads it once and only
// aggregates reach the library; requests are answered from the library. Per record we keep (date, estate, district,
// price, saleable area); floor, coordinates and credit level are never read.
// Format shape from the publisher's file as probed 2026-10-21 (all values are strings); see source.test.ts.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const FILE_URL = "https://data.housingauthority.gov.hk/dataset/hass/tps_sale_transactions_en.json";
export const PAGE_URL = "https://data.gov.hk/en-data/dataset/hk-housing-tpssale-tpssale";

export const INFO: SourceInfo = {
  id: "hk-ha-tps-sales",
  country: "HK (Hong Kong, public housing estates)",
  category: "home sales (discounted sales of public flats to sitting tenants)",
  name: "Hong Kong Housing Authority: Tenants Purchase Scheme (TPS) sale transactions",
  publisher: "Hong Kong Housing Authority, via DATA.GOV.HK",
  what_is_recorded:
    "One row per flat sold under the Tenants Purchase Scheme: estate, district, sale price in HKD, saleable floor area in square metres, the discount to the assessed value and the assignment date. " +
    "These are public rental flats sold to their sitting tenants at a government discount, so the price paid is far below the market price.",
  price_type: "transaction",
  freshness: "The Housing Authority refreshes the file quarterly; each answer names the newest assignment date it covers.",
  licence:
    "DATA.GOV.HK Terms and Conditions (Digital Policy Office, HKSAR Government): the data may be browsed, downloaded, distributed and reproduced for commercial and non-commercial purposes free of charge, on condition that the source is identified and the Government, the Relevant Organisations and DATA.GOV.HK are acknowledged. Terms may be amended without notice; data is provided as is.",
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution: "Source: Hong Kong Housing Authority, via DATA.GOV.HK. Aggregated by ProofPrice; not endorsed by the Government of the Hong Kong SAR.",
  homepage: PAGE_URL,
  limits:
    "Only Tenants Purchase Scheme sales of public rental flats to sitting tenants at a government discount: a small, special slice of Hong Kong homes, NOT market prices and not private flats. " +
    "Prices are far below the market. Estates with fewer than 5 sales in a window get no figure. Transactions with a blank or implausible price (under HKD 30,000 or HKD 20 million and over) are dropped. Aggregates only; the file's coordinates, floor and credit fields are never used.",
  method_version: "1",
};

export const WINDOWS = [12, 24, 60] as const;
export const MIN_PRICE = 30_000;
export const MAX_PRICE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [2_000, 400_000]; // HKD per square metre of saleable area
const SQM_TO_SQFT = 10.7639;

export interface Sale {
  date: string; // YYYY-MM-DD
  estate: string; // slug
  district: string; // slug
  price: number; // HKD
  m2: number | null; // HKD per square metre of saleable area
}

export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string): string => normaliseName(raw).replace(/ /g, "-");

/** "22-09-2026" -> "2026-09-22"; anything else -> null. */
export function parseDate(s: unknown): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The saleable area in square metres from a field like "26/284" (sq m / sq ft); a single number is taken as sq m. */
export function parseSqm(s: unknown): number | null {
  const first = String(s ?? "").split("/")[0].replace(/,/g, "").trim();
  const v = Number(first);
  return first !== "" && Number.isFinite(v) && v >= 10 && v <= 400 ? v : null;
}

const money = (s: unknown): number | null => {
  const t = String(s ?? "").replace(/,/g, "").trim();
  if (t === "" || t.toLowerCase() === "null") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Reduce the publisher's JSON to plausible sales. Throws when the file has changed shape. */
export function parseTps(json: any): Sale[] {
  const recs: any[] | undefined = Array.isArray(json) ? json : json?.records;
  if (!Array.isArray(recs)) throw new SourceError("The TPS file has an unexpected format (no records list)", FILE_URL);
  if (recs.length && !("estate_name" in recs[0] && "transaction_price" in recs[0] && "assignment_date" in recs[0])) {
    throw new SourceError("The TPS file has an unexpected format (columns changed)", Object.keys(recs[0] ?? {}).join(",").slice(0, 200));
  }
  const out: Sale[] = [];
  for (const r of recs) {
    const date = parseDate(r.assignment_date);
    const price = money(r.transaction_price);
    const estate = slug(String(r.estate_name ?? ""));
    if (!date || price === null || !estate) continue;
    if (price < MIN_PRICE || price >= MAX_PRICE) continue;
    const sqm = parseSqm(r.saleable_floor_area);
    let m2: number | null = null;
    if (sqm !== null) {
      const v = price / sqm;
      if (v >= M2_RANGE[0] && v <= M2_RANGE[1]) m2 = v;
    }
    out.push({ date, estate, district: slug(String(r.location ?? "")), price, m2 });
  }
  return out;
}

export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Library key of a district: "d-<slug>" so it can never clash with an estate slug. */
export const districtArea = (slugName: string): string => `d-${slugName}`;

/** Aggregates for every window ending at the newest sale. Items: "any:<N>m" (HKD per flat) and "any-m2:<N>m" (HKD per m2). */
export function dailyRows(sales: Sale[], today: string): { date: string; rows: DailyRow[] } {
  const valid = sales.filter((s) => s.date <= today);
  if (!valid.length) throw new SourceError("The TPS file held no usable sales");
  const last = valid.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const byEstate: { area: string; item: string; price: number }[] = [];
  const byDistrict: { area: string; item: string; price: number }[] = [];
  for (const w of WINDOWS) {
    const from = monthsBack(last, w);
    for (const s of valid) {
      if (s.date <= from || s.date > last) continue;
      byEstate.push({ area: s.estate, item: `any:${w}m`, price: s.price });
      if (s.m2 !== null) byEstate.push({ area: s.estate, item: `any-m2:${w}m`, price: s.m2 });
      if (s.district) {
        byDistrict.push({ area: districtArea(s.district), item: `any:${w}m`, price: s.price });
        if (s.m2 !== null) byDistrict.push({ area: districtArea(s.district), item: `any-m2:${w}m`, price: s.m2 });
      }
    }
  }
  const rows = [...aggregateDaily(byEstate, true), ...aggregateDaily(byDistrict, false)].filter((r) => r.n >= MIN_PUBLISH);
  return { date: last, rows: rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item)) };
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** The daily collector: one plain GET of the whole file, reduced in memory to aggregates. */
export async function tpsHarvest(): Promise<HarvestResult> {
  let res: Response;
  try {
    res = await fetch(FILE_URL, { headers: UA, signal: AbortSignal.timeout(240_000) });
  } catch (err: any) {
    throw new SourceError("Could not reach the Housing Authority file", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok) throw new SourceError(`Housing Authority returned HTTP ${res.status}`, FILE_URL, res.status);
  const sales = parseTps(await res.json());
  const { date, rows } = dailyRows(sales, new Date().toISOString().slice(0, 10));
  return {
    date,
    currency: "HKD",
    unit: "per flat",
    rows,
    note: `Windows of 12/24/60 months ending ${date}; Tenants Purchase Scheme sales of public flats at a government discount (not market prices).`,
  };
}

// ---------- the question ----------

/** Resolve a place to a library area. "" / "Hong Kong" = all TPS estates. Estate and district names come from the latest library day. */
export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(hong kong|hk|estate|district)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "all Tenants Purchase Scheme estates in Hong Kong" };
  const s = n.replace(/ /g, "-");
  const estates = known.filter((k) => !k.startsWith("d-"));
  const districts = known.filter((k) => k.startsWith("d-"));
  const bare = (x: string) => x.replace(/-(estate)$/, "");
  const e = estates.find((k) => k === s) ?? estates.find((k) => bare(k) === s) ?? estates.find((k) => s.length >= 5 && bare(k).startsWith(s));
  if (e) return { area: e, label: title(e) };
  const d = districts.find((k) => k === districtArea(s)) ?? districts.find((k) => s.length >= 4 && k.startsWith(districtArea(s)));
  if (d) return { area: d, label: `${title(d.slice(2))} district` };
  return null;
}

const title = (s: string): string => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function tpsKey(p: { town?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, months, item: `any:${months}m` };
}

export function tpsHistoryKey(p: { town?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = tpsKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Hong Kong (TPS sales)` } : null;
}

const H = (v: number) => fmtMoney(v, "HKD");
const NOT_MARKET =
  "These are Tenants Purchase Scheme sales of public rental flats to sitting tenants at a government discount, so they are NOT market prices and far below what private flats cost.";

export function tpsAnswerFromRow(
  row: DailyRow & { date: string },
  m2: (DailyRow & { date: string }) | undefined,
  q: { label: string; months: number; baseUrl?: string },
): PriceAnswer {
  return buildAnswer({
    source: INFO,
    query: { country: "HK", town: q.label, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "HKD",
    unit: "per flat (discounted public flat)",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Hong Kong: median and 10th-90th percentile of the sale price on Housing Authority Tenants Purchase Scheme transactions (public rental flats sold to sitting tenants at a government discount) over the last 12, 24 or 60 months " +
      "(your request is rounded to the nearest) ending at the newest assignment date. Not market prices. Blank or implausible prices are dropped; fewer than 5 sales gives no figure.",
    describe: (x) =>
      `Public flats sold under the Housing Authority's Tenants Purchase Scheme in ${q.label} had a median sale price of ${H(x.median)} (typical range ${H(x.low)} to ${H(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${H(m2.median)} per m2 of saleable area` : "") +
      `. ${NOT_MARKET}`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "Tenants Purchase Scheme sale price of a public rental flat sold to its sitting tenant at a government discount; not a market price",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "HKD" } : null,
      area_unit_note: `Saleable area in square metres (1 m2 = ${SQM_TO_SQFT} sq ft).`,
    },
  });
}

export async function tpsHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  if (input.property_type && !["any", "flat", "apartment"].includes(input.property_type.toLowerCase())) {
    throw new InputError("property_type: Hong Kong public-housing sales are flats only ('any', the default)");
  }
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  const k = tpsKey(input, known);
  if (!k) {
    const estates = known.filter((a) => !a.startsWith("d-")).slice(0, 25).map(title).join(", ");
    throw new InputError(`Unknown estate or district '${input.town}'. Give a public housing estate such as Shan King or Cheung Hong, a district, or leave town out for all Tenants Purchase Scheme estates. Some estates with enough sales: ${estates}.`);
  }
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const pick = (item: string) => { const r = readDaily(INFO.id, { area: k.area, item, from, to }); return r[r.length - 1]; };
  let row = pick(k.item), usedMonths = k.months, widened = false;
  if (!row || row.n < MIN_PUBLISH) {
    for (const m of WINDOWS) {
      if (m <= k.months) continue;
      const r = pick(`any:${m}m`);
      if (r && r.n >= MIN_PUBLISH) { row = r; usedMonths = m; widened = true; break; }
    }
  }
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO, query: { country: "HK", town: k.label, months: k.months },
      summary: null, currency: "HKD", unit: "per flat (discounted public flat)", period: { from: null, to: null },
      method: "Rolling windows of the Housing Authority Tenants Purchase Scheme sales.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} sales in ${k.label} in any window up to 60 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} Tenants Purchase Scheme sales are recorded in ${k.label} in the last 60 months, so no price range is published. Try a district or leave town out for all estates.`;
    return a;
  }
  const m2row = pick(`any-m2:${usedMonths}m`);
  const a = tpsAnswerFromRow(row, m2row, { label: k.label, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} sales in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
