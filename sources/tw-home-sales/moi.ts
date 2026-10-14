// Shared by tw-home-sales and tw-rents: how to find, fetch and read the Ministry of the Interior's (MOI) "actual price
// registration" open data (不動產成交案件實際資訊), https://plvr.land.moi.gov.tw/DownloadOpenData.
//
// What the portal publishes (formats checked live on 2026-10-14, see source.test.ts for real rows):
//  - a ZIP of CSV files per release, one file per city or county and kind: <letter>_lvr_land_a.csv (sales, 買賣),
//    _b (presales, 預售屋), _c (rentals, 租賃), plus _build / _land / _park detail tables and a manifest;
//  - the current 10-day release:   /Download?type=zip&fileName=lvr_landcsv.zip
//  - previous 10-day releases:     /DownloadHistory?type=history&fileName=<YYYYMMDD of publication>
//  - quarterly ("season") files:   /DownloadSeason?season=<ROC year>S<1-4>&type=zip&fileName=lvr_landcsv.zip
//  - CSV is UTF-8 with a BOM; line 1 is the Chinese header, line 2 an English header; dates are ROC (year + 1911).
// No key, login or captcha is involved. Pure functions here are unit-tested; the download helpers are used by harvest().

import { inflateRawSync } from "node:zlib";
import { SourceError } from "../../lib/http";

export const BASE = "https://plvr.land.moi.gov.tw";
export const PORTAL_URL = `${BASE}/DownloadOpenData`;
export const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** The letter in the portal's file names -> the city or county (Chinese, as the register writes it). */
export const CITY_BY_CODE: Record<string, string> = {
  A: "臺北市", B: "臺中市", C: "基隆市", D: "臺南市", E: "高雄市", F: "新北市", G: "宜蘭縣", H: "桃園市", I: "嘉義市",
  J: "新竹縣", K: "苗栗縣", M: "南投縣", N: "彰化縣", O: "新竹市", P: "雲林縣", Q: "嘉義縣", T: "屏東縣", U: "花蓮縣",
  V: "臺東縣", W: "金門縣", X: "澎湖縣", Z: "連江縣",
};

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ROC date "1150901" (or "990101") -> "2026-09-01"; null if it is not a real date. */
export function rocToIso(s: string | undefined): string | null {
  const m = /^(\d{2,3})(\d{2})(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = `${y}-${pad(mo)}-${pad(d)}`;
  return iso(new Date(out + "T00:00:00Z")) === out ? out : null;
}

/** Last day of the month containing the ISO date. */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}

/** First day of the month `n - 1` months before the month of `anchor` (so a window of n months ending at `anchor` starts here). */
export function windowStart(anchor: string, n: number): string {
  const [y, m] = anchor.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - n, 1)));
}

/** Days back from an ISO date. */
export function daysBefore(date: string, days: number): string {
  return iso(new Date(Date.parse(date + "T00:00:00Z") - days * 86400000));
}

/**
 * The date a library snapshot is stamped with: the last day of the month that contains the date 30 days before the newest
 * transaction. Registrations arrive weeks after a deal, so the newest month is always thin; windows therefore end at the
 * last month that is at least a month old. It also makes the library change once a month instead of every 10 days.
 */
export function anchorOf(newest: string): string {
  return monthEnd(daysBefore(newest, 30));
}

// ---------- CSV ----------

/** UTF-8 (with or without BOM); falls back to Big5, which older MOI files used. */
export function decodeCsv(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("big5").decode(buf);
  }
  return text.replace(/^﻿/, "");
}

export function splitCsvLine(line: string): string[] {
  if (line.indexOf('"') < 0) return line.split(",");
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else f += c;
  }
  out.push(f);
  return out;
}

export interface Table {
  header: string[];
  rows: string[][];
  col(name: string): number;
}

const CJK = /[一-鿿]/;

/**
 * Parse one MOI CSV: row 1 holds the Chinese column names, row 2 the English ones (skipped; a data row always starts with a
 * Chinese district name). Columns are looked up by name, so a reordered or extended file still reads.
 */
export function parseTable(text: string): Table {
  const lines = text.split("\n");
  let header: string[] | null = null;
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    // a quoted field may contain a line break: glue lines until the quotes balance
    while (line.indexOf('"') >= 0 && (line.match(/"/g)!.length & 1) === 1 && i + 1 < lines.length) line += "\n" + lines[++i].replace(/\r$/, "");
    const cells = splitCsvLine(line);
    if (!header) {
      header = cells.map((c) => c.trim());
      continue;
    }
    if (rows.length === 0 && !CJK.test(cells[0] ?? "") && /^[A-Za-z]/.test(cells[0] ?? "")) continue; // the English header row
    rows.push(cells);
  }
  if (!header) throw new SourceError("An MOI CSV file was empty");
  const h = header;
  return { header: h, rows, col: (name) => h.indexOf(name) };
}

// ---------- ZIP ----------

export interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  size: number;
  lho: number;
}

/** Entries of a zip held in memory, from its central directory. */
export function listZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("An MOI download was not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("An MOI zip has a bad directory");
    const nl = buf.readUInt16LE(p + 28);
    out.push({
      name: buf.toString("utf8", p + 46, p + 46 + nl),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      lho: buf.readUInt32LE(p + 42),
    });
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

export function readZipEntry(buf: Buffer, e: ZipEntry): Buffer {
  if (buf.readUInt32LE(e.lho) !== 0x04034b50) throw new SourceError("An MOI zip has a bad entry");
  const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new SourceError(`An MOI zip uses an unsupported method (${e.method})`);
}

/** The per-city CSV files of one kind ("a" sales, "c" rentals) in a release zip: { city code letter, file }. */
export function cityFiles(entries: ZipEntry[], kind: "a" | "b" | "c"): { code: string; entry: ZipEntry }[] {
  const re = new RegExp(`^([a-z])_lvr_land_${kind}\\.csv$`, "i");
  const out: { code: string; entry: ZipEntry }[] = [];
  for (const e of entries) {
    const m = re.exec(e.name);
    if (m && CITY_BY_CODE[m[1].toUpperCase()]) out.push({ code: m[1].toUpperCase(), entry: e });
  }
  return out;
}

// ---------- the portal's release lists (pure parsers of its HTML fragments) ----------

export interface Release {
  /** "current", a 10-day publication date "20261001", or a season "115S3". */
  id: string;
  kind: "current" | "ten-day" | "season";
  url: string;
  /** Registration dates of the sales in the release, ISO. */
  salesFrom: string | null;
  salesTo: string | null;
  /** Contract dates of the rentals in the release, ISO. */
  rentFrom: string | null;
  rentTo: string | null;
}

const ROC_RANGE = "(\\d{2,3})年(\\d{1,2})月(\\d{1,2})日?\\s*至\\s*(\\d{2,3})年(\\d{1,2})月(\\d{1,2})日";
function rocParts(y: string, m: string, d: string): string | null {
  return rocToIso(`${y}${pad(Number(m))}${pad(Number(d))}`);
}

/** "登記日期 115年9月21日至 115年9月30日之買賣案件，及訂約日期 115年8月21日至 115年8月31日之租賃案件" -> the two date ranges. */
export function parseDescription(text: string): Pick<Release, "salesFrom" | "salesTo" | "rentFrom" | "rentTo"> {
  const sales = new RegExp(`登記日期\\s*(?:自\\s*)?${ROC_RANGE}之買賣案件`).exec(text);
  const rent = new RegExp(`(?:訂約日期|申報日期)\\s*(?:自\\s*)?${ROC_RANGE}之租賃`).exec(text);
  return {
    salesFrom: sales ? rocParts(sales[1], sales[2], sales[3]) : null,
    salesTo: sales ? rocParts(sales[4], sales[5], sales[6]) : null,
    rentFrom: rent ? rocParts(rent[1], rent[2], rent[3]) : null,
    rentTo: rent ? rocParts(rent[4], rent[5], rent[6]) : null,
  };
}

export const currentUrl = () => `${BASE}/Download?type=zip&fileName=lvr_landcsv.zip`;
export const tenDayUrl = (id: string) => `${BASE}/DownloadHistory?type=history&fileName=${id}`;
export const seasonUrl = (id: string) => `${BASE}/DownloadSeason?season=${id}&type=zip&fileName=lvr_landcsv.zip`;

/** The current release, from the portal's "本期下載" fragment (/Download_ajax_active). */
export function parseCurrent(html: string): Release | null {
  const d = parseDescription(html);
  if (!d.salesTo) return null;
  return { id: "current", kind: "current", url: currentUrl(), ...d };
}

/** Previous 10-day releases, from /DownloadHistory_ajax_list: "發布日期 20261001 ... desc=資料內容：...", download id in downloadLast('20261001'). */
export function parseTenDay(html: string): Release[] {
  const out: Release[] = [];
  for (const m of html.matchAll(/發布日期\s*(\d{8})[\s\S]*?desc="([^"]*)"[\s\S]*?downloadLast\('(\d{8})'\)/g)) {
    const id = m[3];
    out.push({ id, kind: "ten-day", url: tenDayUrl(id), ...parseDescription(m[2]) });
  }
  return out;
}

/** Quarterly releases, from the m.set('115S3','資料內容：...') lines on /DownloadHistory_ajax_list. */
export function parseSeasons(html: string): Release[] {
  const out: Release[] = [];
  for (const m of html.matchAll(/m\.set\('(\d{3}S[1-4])','([^']*)'\)/g)) {
    out.push({ id: m[1], kind: "season", url: seasonUrl(m[1]), ...parseDescription(m[2]) });
  }
  return out;
}

/** End of a season by its name, for when the portal's description cannot be read: S1 = Mar 10, S2 = Jun 10, S3 = Sep 10, S4 = Dec 10 of the ROC year. */
export function seasonEndFromId(id: string): string | null {
  const m = /^(\d{3})S([1-4])$/.exec(id);
  return m ? `${Number(m[1]) + 1911}-${pad(Number(m[2]) * 3)}-10` : null;
}

/**
 * The releases that can hold transactions dated on or after `needFrom` (an ISO date): the current 10-day file, every
 * 10-day file, and every season whose last registration date is on or after it. Newest first.
 */
export function selectReleases(all: Release[], kind: "sales" | "rents", needFrom: string): Release[] {
  const end = (r: Release) => (kind === "sales" ? r.salesTo : r.rentTo) ?? (r.kind === "season" ? seasonEndFromId(r.id) : null);
  return all
    .filter((r) => {
      const e = end(r);
      return e === null || e >= needFrom;
    })
    .sort((a, b) => (b.salesTo ?? seasonEndFromId(b.id) ?? "").localeCompare(a.salesTo ?? seasonEndFromId(a.id) ?? ""));
}

// ---------- downloads ----------

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 3000, timeoutMs: 240_000 };

const cache = new Map<string, Promise<Buffer>>();

/**
 * Download a URL (retrying), keeping the result for the rest of the process: tw-home-sales and tw-rents read the same release
 * zips, and the collector runs both in one process, so each zip is fetched once.
 */
export function download(url: string, tries = 3): Promise<Buffer> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    let last = "";
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(harvestOptions.timeoutMs) });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        last = `HTTP ${res.status}`;
      } catch (e: any) {
        last = String(e?.message ?? e);
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
    }
    throw new SourceError(`Could not download ${url}: ${last}`);
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url)); // a failure is not kept
  return p;
}

export function clearDownloadCache(): void {
  cache.clear();
}

/** The portal's release lists, newest first. Throws SourceError if its pages no longer look as expected. */
export async function fetchReleases(): Promise<Release[]> {
  const get = async (path: string) => decodeCsv(await download(`${BASE}/${path}`));
  const [active, history] = await Promise.all([get("Download_ajax_active"), get("DownloadHistory_ajax_list")]);
  const cur = parseCurrent(active);
  const seasons = parseSeasons(history);
  const tenDay = parseTenDay(history);
  if (!cur && !seasons.length && !tenDay.length) throw new SourceError("The MOI open-data download page has a new layout (no releases found); this source needs updating.");
  return [...(cur ? [cur] : []), ...tenDay, ...seasons];
}
