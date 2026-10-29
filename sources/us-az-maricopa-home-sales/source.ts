// Maricopa County, Arizona (Phoenix, Scottsdale, Mesa, Tempe, Chandler, Gilbert...) home sales from the County Assessor's
// "Sales Affidavits" file: one row per recorded real-estate sale affidavit, a pipe-delimited text file (269 MB, zipped 61 MB, updated monthly,
// oldest row first) published on the County's ArcGIS open-data hub as Sales_Affidavits.zip.
// The file holds buyer and seller names and street addresses. We never keep them: a row is reduced in memory to
// (sale month, city, ZIP, house or condo, sale price) and only aggregates (5 sales or more) reach the price library.
// Bulk file => the daily collector (harvest) streams the zip once; requests are answered from the library.
// Format checked live on 2026-10-29 through the Probe workflow (see fixtures/sales-head.txt, personal columns blanked).

import { createInflateRaw } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const FILE_URL = "https://www.arcgis.com/sharing/rest/content/items/f3484c72a938497286adc4e5de7e9963/data";
export const HOMEPAGE = "https://data-maricopa.opendata.arcgis.com/datasets/f3484c72a938497286adc4e5de7e9963/about";

export const INFO: SourceInfo = {
  id: "us-az-maricopa-home-sales",
  country: "US (Maricopa County, Arizona only)",
  category: "home sales",
  name: "Sales Affidavits (recorded real-estate sales), Maricopa County Assessor",
  publisher: "Maricopa County Assessor's Office, published on the Maricopa County open-data hub",
  what_is_recorded:
    "One sales affidavit per recorded transfer of a parcel in Maricopa County, Arizona: sale month, sale price, deed type, property type, city and ZIP. " +
    "We read only the sale month, price, deed type, property type, city and ZIP; never names, addresses or parcel numbers.",
  price_type: "transaction",
  freshness: "The County refreshes the file about monthly; sales appear a few weeks after they are recorded. We collect it into our price library every day and each answer names the sale months it covers.",
  licence:
    "No reuse licence is stated for this dataset: the County's open-data record is marked 'custom' and carries only a disclaimer that the Assessor does not guarantee the data is accurate, complete or current. " +
    "Treated as NOT cleared for paid use: every answer from this source is served free of charge.",
  licence_url: HOMEPAGE,
  attribution:
    "Source: Maricopa County Assessor's Office, Sales Affidavits (open-data hub). Aggregated by ProofPrice (medians and percentiles of qualifying house and condo sales). " +
    "The County does not guarantee the accuracy of the data. This is not an endorsement by Maricopa County.",
  homepage: HOMEPAGE,
  limits:
    "Maricopa County, Arizona only (not the rest of Arizona or the United States). Houses (single-family residences) and condominiums/townhouses only; land, commercial and other property is left out. " +
    "Dropped: sales with no price or under $30,000 or $10 million and over, partial-interest transfers, sales between related parties, sales of several parcels together, sales that include personal property, and quit-claim, conveyance and trust deeds. " +
    "A sale is dated by its sale month. Aggregates only, by city and ZIP and a rolling window; never addresses, names or parcel numbers. Prices are the amounts written on the recorded affidavit.",
  method_version: "1",
};

export const WINDOWS = [3, 6, 12, 24] as const;
export const ZIP_WINDOWS = [12, 24] as const;
export const TYPES = ["any", "house", "condo"] as const;
export type Kind = "house" | "condo";
export const MIN_PRICE = 30_000;
export const MAX_PRICE = 10_000_000; // exclusive
/** Deed types that are not arm's-length transfers for money: quit claim, conveyance, deed of trust, gift, trustee transfers of trust property. */
export const SKIP_DEEDS = new Set(["QD", "CV", "DT", "GD", "TR"]);
export const KEEP_MONTHS = 26;

export interface Sale { idx: number; city: string; zip: string; kind: Kind; price: number }

export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

/** Residential kind of PROPERTYTYPEDESCRIPTION (the file cuts it at 20 characters: "Single Family Reside"), or null. */
export function kindOf(desc: string): Kind | null {
  const d = normaliseName(desc);
  if (/^single family/.test(d)) return "house";
  if (/^condo/.test(d) || /^townhouse/.test(d)) return "condo";
  return null;
}

export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
export function idxToYm(idx: number): string {
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
export function idxEndDate(idx: number): string {
  return new Date(Date.UTC(Math.floor(idx / 12), (idx % 12) + 1, 0)).toISOString().slice(0, 10);
}

const REQUIRED = ["SALEDATE_MMYYYY", "SALEPRICE", "DEEDTYPE", "PROPERTYTYPEDESCRIPTION", "SITUSCITY", "SITUSZIP", "PARTIALINTERESTINDICATOR", "MULTIPARCELINDICATOR", "NUMBEROFPARCELS", "BUY_SELLRELATIONSHIPINDICATOR"];

/**
 * A line-by-line reader for the pipe-delimited file: feed it text chunks, it keeps the qualifying sales of the newest months only.
 * Columns are found by header name. A changed layout throws (the collector then fails loudly instead of publishing wrong numbers).
 */
export function createSalesParser(minIdx: number) {
  let carry = "";
  let cols: Record<string, number> | null = null;
  const sales: Sale[] = [];
  let rows = 0;
  const line = (raw: string) => {
    const l = raw.replace(/\r$/, "");
    if (!l) return;
    const f = l.split("|");
    if (!cols) {
      const head = f.map((h) => h.replace(/^﻿/, "").trim().toUpperCase());
      cols = {};
      head.forEach((h, i) => (cols![h] = i));
      const missing = REQUIRED.filter((c) => cols![c] === undefined);
      if (missing.length) throw new SourceError("The Maricopa sales file has an unexpected layout (columns changed)", missing.join(","));
      return;
    }
    rows++;
    const c = cols;
    const date = (f[c.SALEDATE_MMYYYY] ?? "").trim();
    const m = /^(\d{2})(\d{4})$/.exec(date);
    if (!m) return;
    const month = Number(m[1]);
    if (month < 1 || month > 12) return;
    const idx = monthIndex(Number(m[2]), month);
    if (idx < minIdx) return;
    const kind = kindOf(f[c.PROPERTYTYPEDESCRIPTION] ?? "");
    if (!kind) return;
    const price = Number(f[c.SALEPRICE]);
    if (!(f[c.SALEPRICE] ?? "").trim() || !Number.isFinite(price) || price < MIN_PRICE || price >= MAX_PRICE) return;
    if (SKIP_DEEDS.has((f[c.DEEDTYPE] ?? "").trim().toUpperCase())) return;
    if ((f[c.PARTIALINTERESTINDICATOR] ?? "").trim().toUpperCase() === "Y") return;
    if ((f[c.BUY_SELLRELATIONSHIPINDICATOR] ?? "").trim().toUpperCase() === "Y") return;
    if ((f[c.MULTIPARCELINDICATOR] ?? "").trim().toUpperCase() === "Y" && Number(f[c.NUMBEROFPARCELS]) > 1) return;
    if (c.PERSONALPROPERTYINDICATOR !== undefined && (f[c.PERSONALPROPERTYINDICATOR] ?? "").trim().toUpperCase() === "Y") return;
    const zip = /^(\d{5})/.exec((f[c.SITUSZIP] ?? "").trim())?.[1] ?? "";
    sales.push({ idx, city: slug(f[c.SITUSCITY] ?? ""), zip, kind, price });
  };
  return {
    push(chunk: string) {
      const text = carry + chunk;
      const parts = text.split("\n");
      carry = parts.pop() ?? "";
      for (const p of parts) line(p);
    },
    end() {
      if (carry) line(carry);
      carry = "";
      if (!cols) throw new SourceError("The Maricopa sales file was empty");
      return { sales, rows };
    },
  };
}

/** Convenience for tests and small inputs. */
export function parseSales(text: string, minIdx = 0): Sale[] {
  const p = createSalesParser(minIdx);
  p.push(text);
  return p.end().sales;
}

// ---------- aggregates ----------

/** Aggregates for every window ending at the newest sale month. Items: "<type>:<N>m" (USD per home). Cities get 3/6/12/24 months, ZIP codes 12/24. */
export function dailyRows(sales: Sale[], today: string): { date: string; rows: DailyRow[]; lastIdx: number } {
  const todayIdx = monthIndex(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const valid = sales.filter((s) => s.idx <= todayIdx);
  if (!valid.length) throw new SourceError("The Maricopa sales file held no usable house or condo sales");
  const lastIdx = valid.reduce((a, s) => (s.idx > a ? s.idx : a), 0);
  const cityRecs: { area: string; item: string; price: number }[] = [];
  const zipRecs: { area: string; item: string; price: number }[] = [];
  for (const s of valid) {
    const age = lastIdx - s.idx; // 0 = newest month
    for (const m of WINDOWS) {
      if (age >= m) continue;
      for (const t of ["any", s.kind] as const) {
        cityRecs.push({ area: s.city || "unknown-city", item: `${t}:${m}m`, price: s.price });
        if (s.zip && (ZIP_WINDOWS as readonly number[]).includes(m)) zipRecs.push({ area: `zip-${s.zip}`, item: `${t}:${m}m`, price: s.price });
      }
    }
  }
  const rows = [...aggregateDaily(cityRecs, true), ...aggregateDaily(zipRecs, false)].filter((r) => r.n >= MIN_PUBLISH && r.area !== "unknown-city");
  const today10 = idxEndDate(lastIdx);
  return { date: today10 < today ? today10 : today, rows, lastIdx };
}

// ---------- fetching the zip ----------

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Find one entry of a zip held in memory (central directory) and return where its raw data sits. */
export function zipEntry(buf: Buffer, nameRe: RegExp): { method: number; data: Buffer } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("The Maricopa download is not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("The Maricopa zip has a bad directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (nameRe.test(name)) {
      if (csize === 0xffffffff || lho === 0xffffffff) throw new SourceError("The Maricopa zip uses ZIP64, which the collector does not read");
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("The Maricopa zip has a bad entry");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      return { method, data: buf.subarray(start, start + csize) };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new SourceError("The Maricopa zip does not contain the sales text file");
}

/** Stream the (raw deflate or stored) entry through the parser in 1 MB steps, so the 269 MB text never sits in memory. */
export async function parseZip(buf: Buffer, minIdx: number): Promise<{ sales: Sale[]; rows: number }> {
  const { method, data } = zipEntry(buf, /(^|\/)Sales_Affidavits\.txt$/i);
  const parser = createSalesParser(minIdx);
  const dec = new StringDecoder("utf8");
  if (method === 0) {
    for (let i = 0; i < data.length; i += 1 << 20) parser.push(dec.write(data.subarray(i, i + (1 << 20))));
  } else if (method === 8) {
    const inflate = createInflateRaw();
    inflate.end(data);
    for await (const chunk of inflate) parser.push(dec.write(chunk as Buffer));
  } else throw new SourceError(`The Maricopa zip uses an unsupported method (${method})`);
  parser.push(dec.end());
  return parser.end();
}

/** The daily collector: one download of the zip, then the newest 26 months of qualifying house and condo sales. */
export async function maricopaHarvest(): Promise<HarvestResult> {
  const res = await fetch(FILE_URL, { headers: UA, signal: AbortSignal.timeout(280_000) });
  if (!res.ok) throw new SourceError(`Maricopa open data returned HTTP ${res.status}`, FILE_URL, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const now = new Date();
  const minIdx = monthIndex(now.getUTCFullYear(), now.getUTCMonth() + 1) - KEEP_MONTHS;
  const { sales, rows: total } = await parseZip(buf, minIdx);
  const { date, rows, lastIdx } = dailyRows(sales, now.toISOString().slice(0, 10));
  return {
    date,
    currency: "USD",
    unit: "per home",
    rows,
    note: `Windows of 3/6/12/24 months ending ${idxToYm(lastIdx)}; ${sales.length} qualifying house and condo sales kept of ${total} affidavits read.`,
  };
}

// ---------- the place ----------

const ZIP = /^\s*(85\d{3})(?:-\d{4})?\s*$/;
const MARICOPA_CITIES = [
  "phoenix", "scottsdale", "mesa", "tempe", "chandler", "gilbert", "glendale", "peoria", "surprise", "goodyear", "avondale", "buckeye",
  "fountain hills", "cave creek", "carefree", "el mirage", "litchfield park", "paradise valley", "queen creek", "sun city", "sun city west",
  "sun lakes", "tolleson", "youngtown", "wickenburg", "anthem", "laveen", "gila bend", "guadalupe", "rio verde", "tonopah", "waddell", "morristown", "aguila",
];
const STATE_WORDS = /\b(az|arizona|maricopa|maricopa county|county|usa|us|united states)\b/g;

/** Strip state and county words: "Phoenix, AZ" -> "phoenix". */
export function cityText(town: string | undefined): string {
  return normaliseName(town ?? "").replace(STATE_WORDS, " ").replace(/\s+/g, " ").trim();
}

/** True when a US home-sales request is about Maricopa County: state AZ, a Maricopa city, an Arizona ZIP (85xxx), or 'Maricopa'. */
export function isMaricopaRequest(p: { town?: unknown; state?: unknown; postcode?: unknown }): boolean {
  const state = p.state === undefined || p.state === null ? "" : normaliseName(String(p.state));
  if (state) return state === "az" || state === "arizona";
  const postcode = p.postcode === undefined || p.postcode === null ? "" : String(p.postcode);
  if (ZIP.test(postcode)) return true;
  const raw = p.town === undefined || p.town === null ? "" : String(p.town);
  if (!raw.trim()) return false;
  const full = normaliseName(raw);
  if (/\b(az|arizona|maricopa)\b/.test(full)) return true;
  return MARICOPA_CITIES.includes(cityText(raw));
}

/** Resolve a request to a library area. "" / "Maricopa County" = the county. Known areas come from the latest library day. */
export function resolveArea(
  p: { town?: string; postcode?: string },
  known: string[],
): { area: string; label: string } | null {
  const z = ZIP.exec(p.postcode ?? "");
  if (z) {
    const area = `zip-${z[1]}`;
    return known.length && !known.includes(area) ? null : { area, label: `ZIP ${z[1]}` };
  }
  const n = cityText(p.town);
  if (!n) return { area: NATIONAL, label: "Maricopa County" };
  const s = n.replace(/ /g, "-");
  const area = known.find((k) => k === s) ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", AZ" };
}

export function maricopaKey(p: { town?: string; postcode?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const set = place.area.startsWith("zip-") ? ZIP_WINDOWS : WINDOWS;
  const months = (set as readonly number[]).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function maricopaHistoryKey(p: { town?: string; postcode?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = maricopaKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Maricopa County` } : null;
}

// ---------- the answer ----------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const D = (v: number) => fmtMoney(v, "USD");

function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function maricopaAnswerFromRow(
  row: DailyRow & { date: string },
  q: { label: string; type: (typeof TYPES)[number]; months: number; baseUrl?: string },
): PriceAnswer {
  const word = q.type === "any" ? "houses and condos" : q.type === "house" ? "houses" : "condos and townhouses";
  return buildAnswer({
    source: INFO,
    query: { country: "US", town: q.label, property_type: q.type, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "USD",
    unit: "per home",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Maricopa County, Arizona: median and 10th–90th percentile of the sale price on recorded sales affidavits for single-family houses and condominiums/townhouses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest; ZIP codes use 12 or 24) ending at the newest sale month. Dropped: sales under $30,000 or $10 million and over, partial interests, related-party sales, multi-parcel sales, sales with personal property, quit-claim, conveyance and trust deeds.",
    describe: (x) => `${cap(word)} sold in ${q.label} had a median recorded sale price of ${D(x.median)} (typical range ${D(x.low)} to ${D(x.high)}) over the last ${q.months} months.`,
    baseUrl: q.baseUrl,
    extra: { price_basis: "sale price written on the recorded sales affidavit", served_free: "licence for reuse not stated by the publisher" },
  });
}

export async function maricopaHomeSales(input: { town?: string; postcode?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = maricopaKey(input, known);
  if (!k) {
    const cities = known.filter((a) => !a.startsWith("zip-")).slice(0, 30).join(", ");
    throw new InputError(`No figure for '${input.postcode || input.town}' in Maricopa County. Give a Maricopa County city such as Phoenix, Scottsdale, Mesa, Tempe, Chandler or Gilbert, or a ZIP code (85xxx) with enough sales, or leave both out for the whole county. Cities with enough sales: ${cities}.`);
  }
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const pick = (item: string) => { const r = readDaily(INFO.id, { area: k.area, item, from, to }); return r[r.length - 1]; };
  const set = k.area.startsWith("zip-") ? ZIP_WINDOWS : WINDOWS;
  let row = pick(k.item), usedMonths = k.months, widened = false;
  if (!row || row.n < MIN_PUBLISH) {
    for (const m of set) {
      if (m <= k.months) continue;
      const r = pick(`${k.type}:${m}m`);
      if (r && r.n >= MIN_PUBLISH) { row = r; usedMonths = m; widened = true; break; }
    }
  }
  const word = k.type === "any" ? "house and condo" : k.type;
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO, query: { country: "US", town: k.label, property_type: k.type, months: k.months },
      summary: null, currency: "USD", unit: "per home", period: { from: null, to: null },
      method: "Rolling windows of the Maricopa County sales affidavits.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} sales in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} sales are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try a bigger place or leave town out for the whole county.`;
    return a;
  }
  const a = maricopaAnswerFromRow(row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} sales in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
