// Canada university tuition fees: Statistics Canada table 37-10-0045-01, "Canadian and international tuition fees by level of study (current dollars)".
// Weighted average tuition for full-time students at publicly funded degree-granting institutions, by province and level of study, one value per
// academic year (2006/2007 onwards). A published statistic of posted fees: no sample size, no range.
//
// Format checked live on 2026-10-20 (GitHub Actions probe, HTTP 200, application/zip, 10 KB, no key):
//   https://www150.statcan.gc.ca/n1/tbl/csv/37100045-eng.zip -> 37100045.csv (134 KB, UTF-8 with BOM, 960 data rows, quoted fields)
//   header: "REF_DATE","GEO","DGUID","Level of study","UOM","UOM_ID","SCALAR_FACTOR","SCALAR_ID","VECTOR","COORDINATE","VALUE","STATUS","SYMBOL","TERMINATED","DECIMALS"
//   "2026/2027","Canada","2021A000011124","Canadian undergraduate","Current dollars","75","units","0","v...","1.1","8021","","","","0"
//   A missing figure has VALUE "" and STATUS "..". The newest year is at the END of the file. GEO = Canada + the ten provinces + Yukon (Yukon mostly empty).
// The file is small and annual: it is fetched per request (cached in memory for six hours). A daily copy of the newest year (harvest) lets a
// Statistics Canada outage be answered from our copy for seven days (stale-if-error).

import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { OPEN_LICENCE_TEXT, OPEN_LICENCE_URL, openLicenceAttribution, openLicenceNotice } from "../_ca-statcan/licence";
import { PROVINCES, provinceFor } from "../_ca-statcan/geo";

export const TABLE_NAME = "table 37-10-0045-01, Canadian and international tuition fees by level of study (current dollars)";
export const ZIP_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/37100045-eng.zip";
export const HOMEPAGE = "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3710004501";

export const INFO: SourceInfo = {
  id: "ca-statcan-tuition",
  country: "CA (Canada)",
  category: "tuition (average posted annual university tuition fees)",
  name: "Canadian and international tuition fees by level of study (Statistics Canada table 37-10-0045-01)",
  publisher: "Statistics Canada",
  what_is_recorded:
    "The weighted average tuition fee, in current Canadian dollars, charged to full-time students at publicly funded degree-granting institutions for one academic year, " +
    "for Canada and each province, for Canadian undergraduate, Canadian graduate, international undergraduate and international graduate students. One published average per province, level and year.",
  price_type: "official_statistic",
  freshness: "Annual: one value per academic year (2026/2027 was published on 16 September 2026); every answer names its academic year",
  licence: OPEN_LICENCE_TEXT,
  licence_url: OPEN_LICENCE_URL,
  attribution: openLicenceAttribution(TABLE_NAME),
  homepage: HOMEPAGE,
  limits:
    "A weighted average of published (posted) tuition fees, not what any one student paid: grants, bursaries, scholarships and fee waivers are not deducted, and ancillary fees may be excluded. " +
    "One average per province and level, no range and no sample size; programmes differ a lot (medicine, law and MBA programmes cost far more than arts). " +
    "'Canadian' students are Canadian citizens and permanent residents (the home rate). Yukon is mostly not published. Territories other than Yukon are not in the table.",
};

// ---------- reading the zip without a dependency ----------

/** The first file of a zip archive held in memory whose name ends with .csv (stored or deflate). */
export function unzipCsv(buf: Buffer): string {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Statistics Canada did not return a zip file (it may be showing a 'site unavailable' page); try again shortly.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.csv$/i.test(name) || /metadata/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    return (method === 0 ? Buffer.from(raw) : inflateRawSync(raw)).toString("utf8");
  }
  throw new SourceError("The Statistics Canada zip holds no data CSV; the format may have changed and this source needs updating.");
}

// ---------- parsing ----------

export interface FeeRow {
  year: string; // "2026/2027"
  geo: string;
  level: string; // "Canadian undergraduate" ...
  value: number | null;
  status: string; // "" or ".." or "E" ...
}

/** One CSV line into fields (double-quoted, "" is a quote). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const NEEDED = ["REF_DATE", "GEO", "Level of study", "UOM", "VALUE", "STATUS"];

export function parseFeeCsv(text: string): FeeRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The Statistics Canada tuition file is empty; this source needs updating.");
  const head = csvFields(lines[0]);
  const idx = Object.fromEntries(NEEDED.map((n) => [n, head.indexOf(n)]));
  const missing = NEEDED.filter((n) => idx[n] < 0);
  if (missing.length) throw new SourceError(`Statistics Canada changed the tuition file (columns missing: ${missing.join(", ")}); this source needs updating.`);
  const rows: FeeRow[] = [];
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    const year = f[idx["REF_DATE"]];
    if (!/^\d{4}\/\d{4}$/.test(year ?? "")) continue;
    if (f[idx["UOM"]] !== "Current dollars") continue;
    const raw = (f[idx["VALUE"]] ?? "").trim();
    const n = raw === "" ? null : Number(raw);
    rows.push({ year, geo: f[idx["GEO"]], level: f[idx["Level of study"]], value: n !== null && Number.isFinite(n) && n > 0 ? n : null, status: (f[idx["STATUS"]] ?? "").trim() });
  }
  if (rows.length < 40) throw new SourceError("The Statistics Canada tuition file has too few rows; the format may have changed and this source needs updating.");
  return rows;
}

// ---------- the answer ----------

export interface TuitionInput {
  cycle?: string; // first | second
  student_group?: string; // home | international
  study_mode?: string;
  province?: string;
  baseUrl?: string;
}

const LEVEL: Record<string, Record<string, string>> = {
  home: { first: "Canadian undergraduate", second: "Canadian graduate" },
  international: { first: "International undergraduate", second: "International graduate" },
};

/** Resolve "Ontario", "ON", "Quebec", "BC" to the table's GEO label, or Canada. */
export function resolveGeo(province: string | undefined, geos: string[]): string {
  const raw = (province ?? "").trim();
  if (!raw || /^(canada|ca|national|all)$/i.test(raw)) return "Canada";
  const prov = provinceFor(raw);
  const name = prov?.name ?? raw;
  const hit = geos.find((g) => g.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  const known = geos.filter((g) => g !== "Canada").join(", ");
  const territory = PROVINCES.find((p) => p.name === name && !geos.includes(p.name));
  throw new InputError(
    `'${raw}' is not in Statistics Canada's tuition table${territory ? ` (${territory.name} is not published)` : ""}. Give a province (${known}) or leave province out for the Canada average.`,
  );
}

export function tuitionAnswer(rows: FeeRow[], input: TuitionInput): PriceAnswer {
  const cycle = input.cycle ?? "first";
  const group = input.student_group ?? "home";
  const mode = input.study_mode ?? "full-time";
  if (mode !== "full-time") throw new InputError("Canada: Statistics Canada publishes full-time fees only; leave study_mode out or use full-time.");
  if (group !== "home" && group !== "international") {
    throw new InputError('Canada: student_group must be "home" (Canadian citizens and permanent residents, the default) or "international".');
  }
  const level = LEVEL[group][cycle];
  if (!level) throw new InputError('cycle must be "first" (undergraduate) or "second" (graduate).');
  const geos = [...new Set(rows.map((r) => r.geo))];
  const geo = resolveGeo(input.province, geos);
  const series = rows.filter((r) => r.geo === geo && r.level === level).sort((a, b) => a.year.localeCompare(b.year));
  if (!series.length) throw new SourceError(`Statistics Canada has no ${level} series for ${geo}; the table layout may have changed.`);
  const usable = series.filter((r) => r.value !== null);
  const newest = usable[usable.length - 1];
  const label = `${level.startsWith("Canadian") ? level : level.toLowerCase()} students, full-time`;
  const place = geo === "Canada" ? "Canada" : geo;
  if (!newest) {
    return buildStatisticAnswer({
      source: INFO,
      query: { country: "CA", cycle, student_group: group, study_mode: mode, province: geo },
      value: null,
      measure: "average",
      currency: "CAD",
      unit: "per academic year",
      period: { from: null, to: null },
      reference_period: "n/a",
      method: methodText(),
      describe: () => "",
      note: `Statistics Canada publishes no figure for ${label} in ${place}; try another province or leave province out for the Canada average.`,
      baseUrl: input.baseUrl,
    });
  }
  const startYear = Number(newest.year.slice(0, 4));
  const prev = usable.find((r) => r.year === `${startYear - 1}/${startYear}`);
  const change = prev && newest.value ? Math.round(((newest.value - prev.value!) / prev.value!) * 1000) / 10 : null;
  const dollars = (v: number) => `${Math.round(v).toLocaleString("en-CA")} CAD`;
  const caveats = [
    "This is Statistics Canada's weighted average of posted tuition fees for the academic year, not what any one student paid; scholarships, bursaries and waivers are not deducted, and programmes differ widely (professional programmes cost far more).",
  ];
  if (newest.status && newest.status !== "..") caveats.push(`Statistics Canada flags this value with status '${newest.status}'.`);
  const stale = series[series.length - 1].year !== newest.year;
  if (stale) caveats.push(`The ${series[series.length - 1].year} figure is not published for ${place}; the newest available year is shown.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "CA", cycle, student_group: group, study_mode: mode, province: geo },
    value: newest.value,
    measure: "average",
    currency: "CAD",
    unit: "per academic year",
    period: { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` },
    reference_period: newest.year.replace("/", "-"),
    method: methodText(),
    describe: (v) =>
      `In the ${newest.year} academic year, the average tuition fee for ${label} in ${place} is ${dollars(v)} per year` +
      `${change !== null ? ` (${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${prev!.year})` : ""}.`,
    note: caveats.join(" "),
    baseUrl: input.baseUrl,
    extra: {
      place,
      academic_year: newest.year,
      student: label,
      fee_basis: "weighted average of posted tuition fees, full-time students, publicly funded degree-granting institutions, current dollars",
      change_on_previous_year: prev ? { academic_year: prev.year, value: prev.value, percent: change } : null,
      recent_years: usable.slice(-6).map((r) => ({ academic_year: r.year, value: r.value })),
      attribution_notice: openLicenceNotice(TABLE_NAME, `academic year ${newest.year}`),
    },
  });
}

function methodText(): string {
  return (
    "Canada tuition fees: Statistics Canada's weighted average of published tuition fees for full-time students at publicly funded degree-granting institutions (table 37-10-0045-01), " +
    "by province and level of study (Canadian or international, undergraduate or graduate), in current Canadian dollars per academic year. " +
    "We pass on the published average and its academic year, with the change on the year before; it is posted fees, not payments by sampled students, and no range or sample size is published."
  );
}

// ---------- fetch (cached in memory for six hours) ----------

let cache: { at: number; rows: FeeRow[] } | null = null;
const TTL_MS = 6 * 3600_000;

export async function downloadZip(url = ZIP_URL, timeoutMs = 20000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** Download and parse; Statistics Canada sometimes answers a 'site unavailable' HTML page with status 200, so a non-zip reply is retried once. */
export async function loadRows(load: () => Promise<Buffer> = () => downloadZip(), now = Date.now()): Promise<FeeRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  let text: string;
  try {
    text = unzipCsv(await load());
  } catch (err) {
    if (err instanceof SourceError && /not return a zip/.test(err.message)) {
      await new Promise((r) => setTimeout(r, 700));
      text = unzipCsv(await load());
    } else throw err;
  }
  const rows = parseFeeCsv(text);
  cache = { at: now, rows };
  return rows;
}

export function clearCache(): void {
  cache = null;
}

export async function caTuition(input: TuitionInput, load?: () => Promise<Buffer>): Promise<PriceAnswer> {
  return tuitionAnswer(await loadRows(load), input);
}

// ---------- daily copy (stale-if-error) ----------

const NATIONAL_AREA = "ALL";
const areaOf = (geo: string) => (geo === "Canada" ? NATIONAL_AREA : geo);

/** Pure: one library row per province (and Canada = "ALL") and level of study for the newest academic year with a figure.
 *  Each row is one published average: n is NO_COUNT (no record count is published) and the range fields repeat the figure. Dated 1 September of the academic year. */
export function tuitionHarvestRows(rows: FeeRow[]): HarvestResult {
  const usable = rows.filter((r) => r.value !== null);
  if (!usable.length) throw new SourceError("Statistics Canada table 37-10-0045-01 holds no usable tuition average");
  const year = usable.map((r) => r.year).sort().pop()!;
  const newest = new Map<string, FeeRow>();
  for (const r of usable) {
    if (r.year !== year) continue;
    newest.set(`${r.geo}\u0000${r.level}`, r);
  }
  const out = [...newest.values()].map((r) => ({
    area: areaOf(r.geo),
    item: r.level,
    n: NO_COUNT,
    median: r.value as number,
    low: r.value as number,
    high: r.value as number,
    min: r.value as number,
    max: r.value as number,
  }));
  out.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return {
    date: `${year.slice(0, 4)}-09-01`,
    currency: "CAD",
    unit: "per academic year",
    rows: out,
    note: `Statistics Canada table 37-10-0045-01: weighted average posted tuition fees for the ${year} academic year, by province and level of study. Published averages, not counts of records (no record count is published).`,
  };
}

export async function caTuitionHarvest(load: () => Promise<Buffer> = () => downloadZip()): Promise<HarvestResult> {
  return tuitionHarvestRows(parseFeeCsv(unzipCsv(await load())));
}

/** Where a request lives in the library, without asking Statistics Canada: provinces come from the areas of our newest stored day. */
export function tuitionHistoryKey(
  p: { cycle?: string; student_group?: string; province?: string },
  areas: string[],
): { area: string; item: string; label: string } | null {
  const group = p.student_group ?? "home";
  const cycle = p.cycle ?? "first";
  const level = LEVEL[group]?.[cycle];
  if (!level) return null;
  const geos = ["Canada", ...areas.filter((a) => a !== NATIONAL_AREA)];
  try {
    const geo = resolveGeo(p.province, geos);
    return { area: areaOf(geo), item: level, label: `${geo}, ${level.toLowerCase()} students` };
  } catch {
    return null;
  }
}
