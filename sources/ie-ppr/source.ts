// Ireland home sales from the Property Price Register (PSRA). One ~19 MB zip holds every sale since 2010
// (a 111 MB CSV with addresses). We never download it per request: the daily collector (harvest) reads it once,
// keeps only aggregates per county (trailing 12 months) in the price library, and requests are answered from there.

import { inflateRawSync } from "node:zlib";
import { SourceError, InputError } from "../../lib/http";
import { summarise, MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ie-ppr",
  country: "IE (Ireland)",
  category: "home sales",
  name: "Residential Property Price Register",
  publisher: "Property Services Regulatory Authority (PSRA), Ireland",
  what_is_recorded: "Residential property sales declared to Revenue for stamp duty: price paid, sale date, county, new or second-hand.",
  price_type: "transaction",
  freshness: "Updated about monthly; sales appear a few weeks after they happen",
  licence: "Creative Commons Attribution 4.0 (PSRA open data; wording to be confirmed with the publisher)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Property Services Regulatory Authority (PSRA), Residential Property Price Register. Licensed under CC BY 4.0.",
  homepage: "https://www.propertypriceregister.ie/",
  limits:
    "Aggregates only, by county and trailing 12 months; never individual addresses. Excludes sales flagged 'not full market price' and prices quoted without VAT (many new homes).",
};

export const PPR_ZIP_URL =
  "https://www.propertypriceregister.ie/website/npsra/ppr/npsra-ppr.nsf/Downloads/PPR-ALL.zip/$FILE/PPR-ALL.zip";

export const IE_COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois",
  "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo",
  "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow",
];
export const IE_TYPES = ["any", "new", "second-hand"] as const;
export type IeType = (typeof IE_TYPES)[number];

export function normaliseCounty(v: string): string | null {
  const t = v.trim().toLowerCase().replace(/^county\s+/, "").replace(/^co(\.\s*|\s+)/, "");
  return IE_COUNTIES.find((c) => c.toLowerCase() === t) ?? null;
}

/** Split one CSV line (quoted fields, "" escapes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

export interface IeSale {
  date: string; // YYYY-MM-DD
  county: string;
  price: number; // EUR
  kind: "new" | "second-hand";
}

/**
 * Parse the register CSV by column POSITION (the euro sign in the price header is encoding-fragile):
 * 0 date dd/mm/yyyy, 2 county, 4 price "343,000.00", 5 not-full-market-price, 6 VAT exclusive, 7 description.
 * Kept: full-market-price sales with the price including VAT, in a known county, price >= 5,000.
 */
export function parseIePpr(csv: string): IeSale[] {
  const out: IeSale[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = splitCsvLine(line);
    if (c.length < 8) continue;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[0].trim());
    if (!m) continue;
    if (c[5].trim().toLowerCase() === "yes") continue; // not full market price
    if (c[6].trim().toLowerCase() === "yes") continue; // price excludes VAT: not comparable
    const county = normaliseCounty(c[2]);
    if (!county) continue;
    const price = Number(c[4].replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price < 5000) continue;
    const d = c[7].trim().toLowerCase();
    const kind = d.startsWith("new") ? "new" : d.startsWith("second-hand") ? "second-hand" : null;
    if (!kind) continue;
    out.push({ date: `${m[3]}-${m[2]}-${m[1]}`, county, price, kind });
  }
  return out;
}

/** Trailing-12-month aggregates per county and kind, plus Ireland ("ALL"). Date = latest sale in the file. */
export function ieDailyRows(sales: IeSale[]): { date: string; rows: DailyRow[]; from: string } {
  if (!sales.length) throw new SourceError("Property Price Register file held no usable sales");
  const last = sales.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const e = new Date(last + "T00:00:00Z");
  e.setUTCFullYear(e.getUTCFullYear() - 1);
  const from = e.toISOString().slice(0, 10);
  const window = sales.filter((s) => s.date > from && s.date <= last);
  const recs: { area: string; item: string; price: number }[] = [];
  for (const s of window) {
    recs.push({ area: s.county, item: "any", price: s.price });
    recs.push({ area: s.county, item: s.kind, price: s.price });
  }
  return { date: last, rows: aggregateDaily(recs, true), from };
}

/** Read the first (only) file out of a zip held in memory: central directory, then raw deflate. */
export function unzipFirstFile(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("Bad zip directory");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Bad zip entry");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new SourceError(`Unsupported zip method ${method}`);
}

/** The daily collector: download the register once, return the latest trailing-12-month aggregates. */
export async function ieHarvest(): Promise<HarvestResult> {
  const res = await fetch(PPR_ZIP_URL, { headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
  if (!res.ok) throw new SourceError(`Property Price Register returned HTTP ${res.status}`);
  const csv = unzipFirstFile(Buffer.from(await res.arrayBuffer())).toString("latin1");
  const { date, rows, from } = ieDailyRows(parseIePpr(csv));
  return { date, currency: "EUR", unit: "per home", rows, note: `Trailing 12 months ${from} to ${date}; full-market-price sales incl. VAT.` };
}

export function ieHistoryKey(p: { county?: string; property_type?: string }) {
  const county = p.county ? normaliseCounty(p.county) : null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!county || !(IE_TYPES as readonly string[]).includes(t)) return null;
  return { area: county, item: t, label: `${county}, Ireland` };
}

/** Pure: turn the latest library row into an answer. */
export function ieAnswerFromRow(
  row: DailyRow & { date: string },
  q: { county: string | null; type: IeType; baseUrl?: string },
): PriceAnswer {
  const e = new Date(row.date + "T00:00:00Z");
  e.setUTCFullYear(e.getUTCFullYear() - 1);
  const place = q.county ?? "Ireland";
  const typeLabel = q.type === "any" ? "homes" : q.type === "new" ? "new homes" : "second-hand homes";
  return buildAnswer({
    source: INFO,
    query: { country: "IE", county: q.county, property_type: q.type, months: 12 },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per home",
    period: { from: e.toISOString().slice(0, 10), to: row.date },
    method:
      "Median and 10th–90th percentile of full-market-price residential sales in the trailing 12 months to the latest sale in the register. Sales flagged 'not full market price' and prices quoted without VAT are excluded.",
    describe: (x) => `${cap(typeLabel)} in ${place} sold for a median of ${fmtMoney(x.median, "EUR")}; typical range ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")}.`,
    baseUrl: q.baseUrl,
  });
}

export async function ieHomeSales(input: { county?: string; property_type?: string; baseUrl?: string }): Promise<PriceAnswer> {
  let county: string | null = null;
  if (input.county) {
    county = normaliseCounty(input.county);
    if (!county) throw new InputError(`Unknown Irish county '${input.county}'. Use a county such as Dublin, Cork, Galway or Limerick.`);
  }
  const type = (input.property_type ?? "any").toLowerCase() as IeType;
  if (!IE_TYPES.includes(type)) throw new InputError(`property_type must be one of: ${IE_TYPES.join(", ")}`);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("The Irish price library has not been collected yet; try again tomorrow.");
  const to = meta.last_date;
  const rows = readDaily(INFO.id, { area: county ?? NATIONAL, item: type, from: to, to });
  const row = rows[rows.length - 1];
  if (!row || row.n < MIN_PUBLISH) {
    return buildAnswer({
      source: INFO,
      query: { country: "IE", county, property_type: type, months: 12 },
      summary: row ? summarise(Array(row.n).fill(row.median)) : null,
      currency: "EUR", unit: "per home", period: { from: null, to: null },
      method: "Trailing 12 months of the Property Price Register.", describe: () => "", baseUrl: input.baseUrl,
    });
  }
  return ieAnswerFromRow(row, { county, type, baseUrl: input.baseUrl });
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
