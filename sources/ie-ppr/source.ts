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
  licence:
    "PSRA re-use terms (https://www.propertypriceregister.ie/website/npsra/ppr-copyright-en.html): the Authority encourages re-use of its information 'free of charge in any format', provided users 'Acknowledge the source and our copyright', reproduce it accurately and not in a misleading context, and do not use it for 'the principal purpose of advertising or promoting a particular product'. PSRA register data is also listed under Creative Commons Attribution 4.0 on data.gov.ie.",
  licence_url: "https://www.propertypriceregister.ie/website/npsra/ppr-copyright-en.html",
  attribution:
    "Source: Property Services Regulatory Authority (PSRA), Residential Property Price Register, © PSRA. Aggregates calculated by ProofPrice.",
  homepage: "https://www.propertypriceregister.ie/",
  limits:
    "Aggregates only, by county or Dublin postal district and rolling window; never individual addresses. Excludes sales flagged 'not full market price' (for example family transfers), prices under EUR 10,000 and records above EUR 10 million (bulk sales). Prices are per sale as declared for stamp duty, usually one home. New homes are usually recorded without 13.5% VAT: 'new' keeps them as recorded, 'any' leaves out prices recorded without VAT.",
};

/** Single-home ceiling: bulk or portfolio sales (whole apartment blocks) sometimes lack the 'not full market price' flag. */
export const MAX_SINGLE_HOME = 10_000_000;

export const PPR_ZIP_URL =
  "https://www.propertypriceregister.ie/website/npsra/ppr/npsra-ppr.nsf/Downloads/PPR-ALL.zip/$FILE/PPR-ALL.zip";

export const IE_COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois",
  "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo",
  "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow",
];
export const IE_TYPES = ["any", "new", "second-hand"] as const;
export type IeType = (typeof IE_TYPES)[number];

export const IE_MONTHS = [3, 6, 12, 24, 36] as const;
export function snapMonths(m?: number): number {
  const v = m === undefined || !Number.isFinite(m) ? 12 : m;
  return IE_MONTHS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}
export const slug = (county: string) => county.toLowerCase();

/** "Dublin 6", "dublin-6w", "D6" -> "dublin-6" / "dublin-6w"; null if not a Dublin postal district. */
export function dublinDistrict(v: string): string | null {
  const m = /^(?:dublin|d)[\s-]*(\d{1,2})(w?)$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 24) return null;
  return `dublin-${n}${m[2].toLowerCase()}`;
}

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
  district: string | null; // "dublin-6" when the address ends in "Dublin 6"
  vatExcl: boolean; // price as recorded excludes VAT (typical for new homes)
}

/**
 * Parse the register CSV by column POSITION (the euro sign in the price header is encoding-fragile):
 * 0 date dd/mm/yyyy, 2 county, 4 price "343,000.00", 5 not-full-market-price, 6 VAT exclusive, 7 description.
 * Kept: full-market-price sales in a known county, price from 10,000 to MAX_SINGLE_HOME (10 million; larger records are bulk or portfolio sales). VAT-exclusive rows are kept but flagged.
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
    const county = normaliseCounty(c[2]);
    if (!county) continue;
    const price = Number(c[4].replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price < 10000 || price > MAX_SINGLE_HOME) continue;
    const d = c[7].trim().toLowerCase();
    // English, plus the Irish-language descriptions ("... Nua" = new, "... Atháimhe" = second-hand), read as latin-1.
    const kind = d.startsWith("new") || /\bnua\b/.test(d) ? "new" : d.startsWith("second-hand") || /ath[aá]imhe/.test(d) ? "second-hand" : null;
    if (!kind) continue;
    const dm = /dublin\s*(\d{1,2}w?)\s*$/i.exec(c[1].trim());
    const district = county === "Dublin" && dm ? `dublin-${dm[1].toLowerCase()}` : null;
    out.push({ date: `${m[3]}-${m[2]}-${m[1]}`, county, price, kind, district, vatExcl: c[6].trim().toLowerCase() === "yes" });
  }
  return out;
}

/** Date `months` before `last` (YYYY-MM-DD). */
export function monthsBack(last: string, months: number): string {
  const e = new Date(last + "T00:00:00Z");
  e.setUTCMonth(e.getUTCMonth() - months);
  return e.toISOString().slice(0, 10);
}

/**
 * Library rows. date = latest sale in the file. area = county slug / Dublin district / "ALL";
 * item = "<any|new|second-hand>:<3|6|12|24|36>m", each window counted back from the latest sale.
 * "any" leaves out VAT-exclusive prices (they are not comparable); "new" keeps prices as recorded (often ex-VAT).
 */
export function ieDailyRows(sales: IeSale[]): { date: string; rows: DailyRow[] } {
  if (!sales.length) throw new SourceError("Property Price Register file held no usable sales");
  const last = sales.reduce((a, s) => (s.date > a ? s.date : a), "0000-00-00");
  const recs: { area: string; item: string; price: number }[] = [];
  for (const m of IE_MONTHS) {
    const from = monthsBack(last, m);
    for (const s of sales) {
      if (s.date <= from || s.date > last) continue;
      const areas = [NATIONAL, slug(s.county), ...(s.district ? [s.district] : [])]; // each sale once per area
      for (const area of areas) {
        recs.push({ area, item: `${s.kind}:${m}m`, price: s.price });
        if (!s.vatExcl) recs.push({ area, item: `any:${m}m`, price: s.price });
      }
    }
  }
  return { date: last, rows: aggregateDaily(recs, false) };
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

/** The daily collector: download the register once, return aggregates for every window. */
export async function ieHarvest(): Promise<HarvestResult> {
  const res = await fetch(PPR_ZIP_URL, { headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
  if (!res.ok) throw new SourceError(`Property Price Register returned HTTP ${res.status}`);
  const csv = unzipFirstFile(Buffer.from(await res.arrayBuffer())).toString("latin1");
  const { date, rows } = ieDailyRows(parseIePpr(csv));
  return { date, currency: "EUR", unit: "per home", rows, note: `Windows of 3/6/12/24/36 months ending ${date}; full-market-price sales.` };
}

/** Where a request lives in the library. town may be a county or a Dublin postal district. */
export function ieKey(p: { town?: string; county?: string; property_type?: string; months?: number }) {
  const place = p.county ?? p.town;
  let area = NATIONAL;
  let label = "Ireland";
  if (place) {
    const d = dublinDistrict(place);
    const c = normaliseCounty(place);
    if (d) { area = d; label = `Dublin ${d.slice(7).toUpperCase()}`; }
    else if (c) { area = slug(c); label = c; }
    else return null;
  }
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(IE_TYPES as readonly string[]).includes(t)) return null;
  const months = snapMonths(p.months);
  return { area, item: `${t}:${months}m`, label, type: t as IeType, months };
}

export function ieHistoryKey(p: { town?: string; county?: string; property_type?: string; months?: number }) {
  const k = ieKey(p);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Ireland` } : null;
}

/** Pure: turn the latest library row into an answer. */
export function ieAnswerFromRow(
  row: DailyRow & { date: string },
  q: { label: string; type: IeType; months: number; baseUrl?: string },
): PriceAnswer {
  const typeLabel = q.type === "any" ? "homes" : q.type === "new" ? "new homes" : "second-hand homes";
  return buildAnswer({
    source: INFO,
    query: { country: "IE", town: q.label, property_type: q.type, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per home",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Median and 10th–90th percentile of full-market-price residential sales over the last 3, 6, 12, 24 or 36 months (your request is rounded to the nearest) ending at the latest sale in the register. " +
      "Sales flagged 'not full market price' are excluded, as are records above €10 million (bulk or portfolio sales, not single homes). 'any' also leaves out prices recorded without VAT; 'new' keeps prices as recorded, and new homes are usually recorded without 13.5% VAT, so do not compare new with second-hand directly.",
    describe: (x) =>
      `${cap(typeLabel)} in ${q.label} sold for a median of ${fmtMoney(x.median, "EUR")} (full-market-price sales); typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")}.` +
      (q.type === "new"
        ? " New-home prices are as recorded on the register, mostly without 13.5% VAT, so the price a buyer paid is usually higher."
        : q.type === "any"
          ? " Prices recorded without VAT (most new homes) are left out, so this mostly reflects second-hand homes."
          : ""),
    baseUrl: q.baseUrl,
  });
}

export async function ieHomeSales(input: { town?: string; county?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const k = ieKey(input);
  if (!k) {
    const place = input.county ?? input.town;
    if (place && !dublinDistrict(place) && !normaliseCounty(place)) {
      throw new InputError(`Unknown Irish place '${place}'. Use a county (Dublin, Cork, Galway...) or a Dublin postal district such as 'Dublin 6'.`);
    }
    throw new InputError(`property_type must be one of: ${IE_TYPES.join(", ")}`);
  }
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const latest = (area: string, months: number) => {
    const rows = readDaily(INFO.id, { area, item: `${k.type}:${months}m`, from, to });
    return rows[rows.length - 1];
  };
  const typeWord = k.type === "any" ? "homes" : k.type === "new" ? "new homes" : "second-hand homes";
  let row = latest(k.area, k.months);
  let usedMonths = k.months;
  let widenedWindow = false;
  // Too few sales in the window asked for: try longer windows for the SAME place and type (the period in the answer says which).
  if (!row || row.n < MIN_PUBLISH) {
    for (const m of IE_MONTHS) {
      if (m <= k.months) continue;
      const r = latest(k.area, m);
      if (r && r.n >= MIN_PUBLISH) { row = r; usedMonths = m; widenedWindow = true; break; }
    }
  }
  if (!row || row.n < MIN_PUBLISH) {
    // A different place is never passed off as the one asked for: it is offered as a suggestion only.
    const suggestions: string[] = [];
    const wider = k.area.startsWith("dublin-") ? [["dublin", "Dublin"]] : [];
    if (k.area !== NATIONAL) wider.push([NATIONAL, "Ireland"]);
    for (const [area, label] of wider) {
      for (const m of IE_MONTHS) {
        if (m < k.months) continue;
        const r = latest(area, m);
        if (r && r.n >= MIN_PUBLISH) {
          const param = area === NATIONAL ? "omit the town parameter" : `town=${label}`;
          suggestions.push(`${cap(typeWord)} in ${label}, last ${m} months: median ${fmtMoney(r.median, "EUR")} from ${r.n} sales (${param}${k.months === m ? "" : `, months=${m}`}).`);
          break;
        }
      }
    }
    const n = row?.n ?? 0;
    const a = buildAnswer({
      source: INFO,
      query: { country: "IE", town: k.label, property_type: k.type, months: k.months },
      summary: n ? summarise(Array(n).fill(row!.median)) : null, currency: "EUR", unit: "per home", period: { from: null, to: null },
      method: "Rolling windows of the Property Price Register.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${typeWord} sales recorded in ${k.label} in any window up to 36 months`, windows_tried_months: IE_MONTHS.filter((m) => m >= k.months) },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${typeWord} sales are recorded in ${k.label} in the last ${IE_MONTHS[IE_MONTHS.length - 1]} months, so no price range is published (it would identify individual sales).` +
      (suggestions.length ? ` Nearest wider figure: ${suggestions[0]}` : "");
    if (suggestions.length) a.suggestions = suggestions;
    return a;
  }
  const a = ieAnswerFromRow(row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widenedWindow) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${typeWord} sales in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
