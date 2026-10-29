// France live pump prices from the Ministère de l'Économie open feed (updated ~every 10 minutes).
// Station addresses are business addresses and are returned for the cheapest stations.

import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { BackfillResult, HarvestResult, SourceInfo } from "../../lib/plugin";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { MIN_PUBLISH } from "../../lib/stats";
import { aggregateDaily } from "../../lib/library/aggregate";
import { previousByKey } from "../../lib/library/check";
import type { LibraryRow } from "../../lib/library/store";
import type { Fuel } from "../../lib/fuels";
import { nationalRow, widenSentence } from "../../lib/widen";

export const INFO: SourceInfo = {
  id: "fr-fuel",
  country: "FR",
  category: "fuel (pump prices)",
  name: "Prix des carburants en France – flux instantané v2",
  publisher: "Ministère de l'Économie via data.economie.gouv.fr",
  what_is_recorded: "Current pump price per litre at each filling station, by fuel type, with last-update time.",
  price_type: "posted_pump_price",
  freshness: "About every 10 minutes",
  licence: "Licence Ouverte / Etalab 2.0",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  attribution: "Source: Ministère de l'Économie – prix des carburants (Licence Ouverte / Etalab 2.0).",
  homepage: "https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/",
  limits:
    "Posted pump prices in euros per litre, taxes included, as each station reports them; not individual receipts (loyalty-card or other discounts are not shown). " +
    "Prices a station has not updated in the last 8 days are left out, and prices of 0 or outside 0.30-5 EUR are treated as missing.",
};


const ENDPOINT =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

/** A price not updated for this many days is treated as no longer posted (closed or silent station). */
const STALE_DAYS = 8;

export const FR_FUELS = ["gazole", "sp95", "sp98", "e10", "e85", "gplc"] as const;
export type FrFuel = (typeof FR_FUELS)[number];

/** Our common fuel names -> the French feed's names. */
export const FR_NAME: Partial<Record<Fuel, FrFuel>> = {
  diesel: "gazole",
  petrol95: "sp95",
  petrol98: "sp98",
  e10: "e10",
  e85: "e85",
  lpg: "gplc",
};
const FUEL_LABEL: Record<FrFuel, string> = {
  gazole: "Diesel (Gazole)",
  sp95: "Unleaded 95 (SP95)",
  sp98: "Unleaded 98 (SP98)",
  e10: "Unleaded 95-E10",
  e85: "E85 bioethanol",
  gplc: "LPG (GPLc)",
};

export function buildFrUrl(where: string, offset: number): string {
  const p = new URLSearchParams({ where, limit: "100", offset: String(offset) });
  return `${ENDPOINT}?${p.toString()}`;
}

/** Plausible pump price bounds in EUR per litre: anything else (0, 0.001, 9.999...) is a placeholder or slip, not a price. */
export const FR_MIN_PRICE = 0.3;
export const FR_MAX_PRICE = 5;

export function normalisePrice(v: unknown): number {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const eur = n > 20 ? n / 1000 : n; // older feeds used milli-euros
  return eur >= FR_MIN_PRICE && eur <= FR_MAX_PRICE ? eur : NaN;
}

export interface Station {
  id: string;
  address: string;
  town: string;
  postcode: string;
  department: string | null;
  price: number;
  updated: string | null;
}

/** Department code from a record: the feed's own field, else derived from the postcode (Corsica 2A/2B, overseas 97x). */
export function frDepartment(r: any): string | null {
  const own = String(r?.code_departement ?? "").trim().toUpperCase();
  if (/^(\d{2,3}|2A|2B)$/.test(own)) return own;
  const cp = String(r?.cp ?? "").replace(/\D/g, "");
  if (cp.length !== 5) return null;
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  return cp.slice(0, 2);
}

export function parseFrRecords(json: any, fuel: FrFuel): Station[] {
  const recs = json?.results;
  if (!Array.isArray(recs)) throw new SourceError("Unexpected response from data.economie.gouv.fr");
  return recs
    .map((r: any) => ({
      id: String(r.id ?? ""),
      address: String(r.adresse ?? ""),
      town: String(r.ville ?? ""),
      postcode: String(r.cp ?? ""),
      department: frDepartment(r),
      price: normalisePrice(r[`${fuel}_prix`]),
      updated: r[`${fuel}_maj`] ? String(r[`${fuel}_maj`]) : null,
    }))
    .filter((s: Station) => Number.isFinite(s.price));
}

/** Prices not updated in the last STALE_DAYS days (closed or silent stations) are left out; an unreadable timestamp is kept. */
export function frFreshStations<T extends { updated: string | null }>(stations: T[], today: string): T[] {
  const cutoffMs = Date.parse(today + "T00:00:00Z") - STALE_DAYS * 86400000;
  return stations.filter((st) => {
    const t = st.updated ? Date.parse(st.updated) : NaN;
    return !(Number.isFinite(t) && t < cutoffMs);
  });
}

export async function frFuelNow(input: {
  postcode?: string;
  department?: string;
  fuel: FrFuel;
  today?: string;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  // A department code (08, 2A, 971) sent as the postcode is what it is: answer for the department instead of finding no station.
  if (input.postcode && /^\s*(\d{2,3}|2[AB])\s*$/i.test(input.postcode)) {
    input = { ...input, department: input.postcode.trim(), postcode: undefined };
  }
  let where: string;
  let area: string;
  if (input.postcode) {
    const cp = input.postcode.replace(/[^0-9]/g, "").slice(0, 5);
    where = `cp="${cp}"`;
    area = `postcode ${cp}`;
  } else if (input.department) {
    const d = input.department.replace(/[^0-9AB]/gi, "").toUpperCase().slice(0, 3);
    where = `code_departement="${d}"`;
    area = `department ${d}`;
  } else {
    throw new InputError("Give a French postcode or department code.");
  }
  const reported: Station[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const json = await fetchJson(buildFrUrl(where, offset), {}, 15000);
    const page = parseFrRecords(json, input.fuel);
    reported.push(...page);
    if (!Array.isArray(json?.results) || json.results.length < 100) break;
  }
  const local = frAnswer(reported, { fuel: input.fuel, area, query: input, today: input.today, baseUrl: input.baseUrl });
  // Niche fuels (LPG, E85) are sold at few stations: a thin department gets the labelled national figure, never a bare refusal.
  if (local.status !== "ok" && input.department && !input.postcode) {
    // The department's region first (finer), then the national figure.
    const regionCode = frRegionOf(input.department!.replace(/[^0-9AB]/gi, "").toUpperCase());
    const wide =
      (regionCode ? frWidenToNational(input, area, undefined, regionCode) : null) ??
      frWidenToNational(input, area, local.extra?.stations_counted as number | undefined);
    if (wide) return wide;
  }
  // A thin postcode (few LPG/E85 stations): first its whole department when that has 5 or more, then the national figure.
  if (local.status !== "ok" && input.postcode && frIsNiche(input.fuel)) {
    const cp = input.postcode.replace(/[^0-9]/g, "").slice(0, 5);
    const dep = frDepartment({ cp });
    if (dep) {
      const deptAnswer = await frFuelNow({ department: dep, fuel: input.fuel, today: input.today, baseUrl: input.baseUrl });
      const sentence = `Fewer than 5 stations sell ${FUEL_LABEL[input.fuel]} in postcode ${cp}, so no postcode range is published; this is the figure for department ${dep} instead.`;
      if (deptAnswer.status === "ok" && !(deptAnswer.extra as any)?.widened) {
        return { ...deptAnswer, summary: `${sentence} ${deptAnswer.summary}`, notice: `${sentence} ${deptAnswer.notice}`, extra: { ...deptAnswer.extra, widened: true, widened_from: `postcode ${cp}`, widened_to: `department ${dep}` } };
      }
      if (deptAnswer.status === "ok" && (deptAnswer.extra as any)?.widened) {
        return { ...deptAnswer, extra: { ...deptAnswer.extra, widened_from: `postcode ${cp}` } };
      }
    }
  }
  return local;
}

/** LPG and E85 are sold at few stations, so a thin local area may be widened (diesel and petrol never are). */
export const frIsNiche = (fuel: FrFuel) => fuel === "gplc" || fuel === "e85";

/** The library row for this niche fuel, as a labelled answer: the department's region when `region` is given, else metropolitan France.
 *  Null when the library has no recent row with 5 or more stations. */
export function frWidenToNational(
  input: { department?: string; fuel: FrFuel; today?: string; baseUrl?: string },
  area: string,
  _local?: number,
  region?: string,
): PriceAnswer | null {
  const common = (Object.entries(FR_NAME) as [Fuel, FrFuel][]).find(([, v]) => v === input.fuel)?.[0];
  if (!common || common === "diesel" || common === "petrol95" || common === "petrol98" || common === "e10") return null;
  const whole = region ? FR_REGIONS[region]?.name : "metropolitan France";
  if (!whole) return null;
  const row = nationalRow("fr-fuel", common, input.today ? new Date(input.today + "T12:00:00Z") : undefined, region ?? "ALL");
  if (!row) return null;
  const sentence = widenSentence(FUEL_LABEL[input.fuel], area, whole, row.summary.count);
  const a = buildAnswer({
    source: INFO,
    query: { country: "FR", postcode: null, department: input.department ?? null, fuel: input.fuel },
    summary: row.summary,
    currency: "EUR",
    unit: "per litre",
    period: { from: row.date, to: row.date },
    method:
      `Median and 10th–90th percentile of the latest pump price per litre reported by each station in ${whole} for the selected fuel (our daily copy of ${row.date}). Prices not updated in the last ${STALE_DAYS} days are left out.`,
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]} in ${whole}: the latest posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} per litre; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { widened: true, widened_from: area, widened_to: whole, stations_counted: row.summary.count },
  });
  return { ...a, summary: `${sentence} ${a.summary}`, notice: `${sentence} ${a.notice}` };
}

export function frAnswer(
  reported: Station[],
  q: { fuel: FrFuel; area: string; query: { postcode?: string; department?: string }; today?: string; baseUrl?: string },
): PriceAnswer {
  const input = { ...q.query, fuel: q.fuel, baseUrl: q.baseUrl };
  const area = q.area;
  const stations = frFreshStations(reported, q.today ?? new Date().toISOString().slice(0, 10));
  const leftOut = reported.length - stations.length;
  const s = summarise(stations.map((x) => x.price));
  const updates = stations.map((x) => x.updated).filter(Boolean).sort() as string[];
  const cheapest = [...stations].sort((a, b) => a.price - b.price).slice(0, 3).map(({ department, ...s }) => s);
  return buildAnswer({
    source: INFO,
    query: { country: "FR", postcode: input.postcode ?? null, department: input.department ?? null, fuel: input.fuel },
    summary: s,
    currency: "EUR",
    unit: "per litre",
    period: { from: updates[0]?.slice(0, 10) ?? null, to: updates[updates.length - 1]?.slice(0, 10) ?? null },
    method:
      `Median and 10th–90th percentile of the latest pump price per litre reported by each station in the area for the selected fuel. Prices not updated in the last ${STALE_DAYS} days are left out.`,
    describe: (x) =>
      `${FUEL_LABEL[input.fuel]} in ${area}: the latest posted pump prices (taxes included) have a median of ${fmtMoney(x.median, "EUR")} per litre; typical range (10th–90th percentile) ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across stations.`,
    baseUrl: input.baseUrl,
    extra: { cheapest_stations: cheapest, stations_counted: stations.length, ...(leftOut > 0 ? { stale_prices_left_out: leftOut } : {}) },
  });
}

const EXPORT_URL =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json";
/** National row: metropolitan France only (overseas departments have regulated, very different prices). */
const METRO = "ALL";

/** Metropolitan regions (INSEE codes) and their departments. The library also holds one row per region ("R84" ...), used only to
 *  widen a thin department for LPG/E85 to its region before the national figure. */
export const FR_REGIONS: Record<string, { name: string; departments: string[] }> = {
  R84: { name: "Auvergne-Rhône-Alpes", departments: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"] },
  R27: { name: "Bourgogne-Franche-Comté", departments: ["21", "25", "39", "58", "70", "71", "89", "90"] },
  R53: { name: "Brittany", departments: ["22", "29", "35", "56"] },
  R24: { name: "Centre-Val de Loire", departments: ["18", "28", "36", "37", "41", "45"] },
  R94: { name: "Corsica", departments: ["2A", "2B"] },
  R44: { name: "Grand Est", departments: ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"] },
  R32: { name: "Hauts-de-France", departments: ["02", "59", "60", "62", "80"] },
  R11: { name: "Île-de-France", departments: ["75", "77", "78", "91", "92", "93", "94", "95"] },
  R28: { name: "Normandy", departments: ["14", "27", "50", "61", "76"] },
  R75: { name: "Nouvelle-Aquitaine", departments: ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"] },
  R76: { name: "Occitanie", departments: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] },
  R52: { name: "Pays de la Loire", departments: ["44", "49", "53", "72", "85"] },
  R93: { name: "Provence-Alpes-Côte d'Azur", departments: ["04", "05", "06", "13", "83", "84"] },
};
const REGION_OF = new Map<string, string>(Object.entries(FR_REGIONS).flatMap(([r, v]) => v.departments.map((d) => [d, r] as [string, string])));
export const frRegionOf = (department: string): string | null => REGION_OF.get(department.toUpperCase()) ?? null;

/** One day of aggregates for the price library: every department and fuel, plus each region and France as a whole ("ALL").
 *  Prices not updated in the last 8 days are left out, so closed stations do not freeze the figures. */
export function frDailyRows(records: any[], today: string): HarvestResult {
  const rows: { area: string; item: string; price: number }[] = [];
  for (const [common, fr] of Object.entries(FR_NAME) as [Fuel, FrFuel][]) {
    for (const st of frFreshStations(parseFrRecords({ results: records }, fr), today)) {
      if (!st.department) continue;
      rows.push({ area: st.department, item: common, price: st.price });
      const region = frRegionOf(st.department);
      if (region) rows.push({ area: region, item: common, price: st.price });
      if (!st.department.startsWith("97") && !st.department.startsWith("98")) rows.push({ area: METRO, item: common, price: st.price });
    }
  }
  return { date: today, currency: "EUR", unit: "per litre", rows: aggregateDaily(rows, false) };
}

/** A day whose station count for any fuel falls below this share of the previous library day's count is not written. */
export const FR_MIN_COUNT_SHARE = 0.7;
/** Fuels with fewer stations than this the day before are too small to judge by share. */
const FR_GUARD_MIN_PREVIOUS = 50;

/** Inside count guard (outside-check pilot, 22 Oct 2026): a half-empty feed barely moves the average price, so a price check passes it.
 *  Returns a plain-English message when, for any fuel, the number of metropolitan stations (the national "ALL" row's n) is below
 *  FR_MIN_COUNT_SHARE of the previous library day's; null when the day is fine. Pure: `previous` is previousByKey("fr-fuel", date). */
export function frCountGuard(day: HarvestResult, previous: Map<string, LibraryRow>): string | null {
  const today = new Map<string, number>();
  for (const r of day.rows) if (r.area === METRO) today.set(r.item, Number.isFinite(r.n) ? r.n : 0);
  const problems: string[] = [];
  for (const [key, prev] of previous) {
    const [area, item] = key.split("\u0000");
    if (area !== METRO || !Number.isFinite(prev.n) || prev.n < FR_GUARD_MIN_PREVIOUS) continue;
    const now = today.get(item) ?? 0;
    if (now < FR_MIN_COUNT_SHARE * prev.n) {
      problems.push(`${item}: ${now} stations against ${prev.n} on ${prev.date} (${Math.round((100 * now) / prev.n)}%)`);
    }
  }
  if (!problems.length) return null;
  // scripts/harvest.ts keeps the first 300 characters of a failure, so the message is short and puts the figures first.
  return `Count guard, ${day.date} NOT written (previous day kept): ${problems.join("; ")}; below ${Math.round(FR_MIN_COUNT_SHARE * 100)}% of the previous day. Feed incomplete? Re-run later, or --accept-changes if real.`;
}

export async function frHarvest(): Promise<HarvestResult> {
  const fields = ["id", "cp", "code_departement", ...FR_FUELS.flatMap((f) => [`${f}_prix`, `${f}_maj`])].join(",");
  let records: any;
  try {
    records = await fetchJson(`${EXPORT_URL}?${new URLSearchParams({ select: fields })}`, {}, 180000);
  } catch {
    records = await fetchJson(EXPORT_URL, {}, 180000); // field list changed: take everything
  }
  if (!Array.isArray(records)) throw new SourceError("Unexpected export format from data.economie.gouv.fr");
  const day = frDailyRows(records, new Date().toISOString().slice(0, 10));
  // Throwing here makes scripts/harvest.ts write nothing for the day and record the message as last_error (shown by /api/v1/library).
  const problem = process.argv.includes("--accept-changes") ? null : frCountGuard(day, previousByKey("fr-fuel", day.date));
  if (problem) throw new SourceError(problem);
  return day;
}

export function frHistoryKey(p: { postcode?: string; department?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!FR_NAME[p.fuel as Fuel]) return null;
  if (p.postcode) {
    const d = frDepartment({ cp: p.postcode });
    return d ? { area: d, item: p.fuel, label: `department ${d}` } : null;
  }
  if (p.department) {
    const d = p.department.trim().toUpperCase();
    return /^(\d{2,3}|2A|2B)$/.test(d) ? { area: d, item: p.fuel, label: `department ${d}` } : null;
  }
  return { area: "ALL", item: p.fuel, label: "metropolitan France" };
}

// ---------------------------------------------------------------------------------------------------------------------
// History (backfill): the Ministry's yearly archives (data.gouv.fr "Prix des carburants en France - annuel"), a zip of one XML
// file per year listing every price change of every station. We stream the file and keep only monthly aggregates:
// for each station and fuel, the LAST price it posted in the month; then median / 10th / 90th percentile per department and
// for metropolitan France ("ALL"). Raw rows, station ids and addresses are never stored.
// ---------------------------------------------------------------------------------------------------------------------

const ARCHIVE_URL = (year: number) => `https://donnees.roulez-eco.fr/opendata/annee/${year}`;
const ARCHIVE_FUEL: Record<string, Fuel> = { gazole: "diesel", sp95: "petrol95", sp98: "petrol98", e10: "e10", e85: "e85", gplc: "lpg" };

/** Streaming reader for the yearly XML: feed it one line at a time. Pure and unit-tested; keeps no raw records. */
export class FrArchiveReader {
  readonly months = new Map<string, Map<string, number[]>>();
  private dept: string | null = null;
  private last = new Map<string, { maj: string; price: number }>(); // "fuel|month" -> latest price of the current station
  constructor(private readonly fromMonth: string, private readonly toMonth: string) {}

  line(raw: string): void {
    const l = raw.trim();
    if (l.startsWith("<pdv ")) {
      this.flush();
      const cp = /\scp="([^"]*)"/.exec(l)?.[1] ?? "";
      this.dept = frDepartment({ cp });
    } else if (l.startsWith("</pdv")) {
      this.flush();
    } else if (l.startsWith("<prix ") && this.dept) {
      const nom = /\snom="([^"]*)"/.exec(l)?.[1]?.toLowerCase();
      const maj = /\smaj="([^"]*)"/.exec(l)?.[1];
      const val = /\svaleur="([^"]*)"/.exec(l)?.[1];
      const item = nom ? ARCHIVE_FUEL[nom] : undefined;
      if (!item || !maj || !/^\d{4}-\d{2}-\d{2}/.test(maj)) return;
      const month = maj.slice(0, 7);
      if (month < this.fromMonth || month > this.toMonth) return;
      const price = normalisePrice(val);
      if (!Number.isFinite(price)) return;
      const k = `${item}|${month}`;
      const prev = this.last.get(k);
      if (!prev || maj >= prev.maj) this.last.set(k, { maj, price });
    }
  }

  private flush(): void {
    if (this.dept) {
      const overseas = this.dept.startsWith("97") || this.dept.startsWith("98");
      for (const [k, v] of this.last) {
        const [item, month] = k.split("|");
        let m = this.months.get(month);
        if (!m) this.months.set(month, (m = new Map()));
        for (const area of overseas ? [this.dept] : [this.dept, METRO]) {
          const key = `${area}\u0000${item}`;
          const arr = m.get(key);
          if (arr) arr.push(v.price);
          else m.set(key, [v.price]);
        }
      }
    }
    this.last.clear();
    this.dept = null;
  }

  finish(): void {
    this.flush();
  }
}

/** Monthly rows (thin groups are dropped later by the platform; here only an empty group is skipped). */
export function frMonthlyRows(months: Map<string, Map<string, number[]>>): BackfillResult["periods"] {
  const out: BackfillResult["periods"] = [];
  for (const month of [...months.keys()].sort()) {
    const rows = [];
    for (const [key, prices] of months.get(month)!) {
      const [area, item] = key.split("\u0000");
      if (prices.length < MIN_PUBLISH) continue;
      const s = summarise(prices);
      if (!s) continue;
      rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
    }
    rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
    out.push({ period: month, rows });
  }
  return out;
}

async function downloadArchive(year: number, dest: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ARCHIVE_URL(year), { headers: { "user-agent": "ProofPrice-Historian/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
      if (res.status === 404) return false;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
      return true;
    } catch (e) {
      if (attempt === 3) throw new SourceError(`France archive ${year} could not be downloaded: ${String((e as Error).message)}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  return false;
}

/** Stream one yearly zip through `unzip -p` line by line into the reader. */
async function readArchive(zipPath: string, reader: FrArchiveReader): Promise<void> {
  const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "inherit"] });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new SourceError(`unzip exited with ${code}`))));
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) reader.line(line);
  await done;
  reader.finish();
}

/** Monthly medians per department and fuel from the yearly archives. from / to are YYYY-MM-DD; only whole past months are kept. */
export async function frBackfill(from: string, to: string): Promise<BackfillResult> {
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const dir = mkdtempSync(path.join(os.tmpdir(), "fr-archive-"));
  const periods: BackfillResult["periods"] = [];
  try {
    for (let year = Number(fromMonth.slice(0, 4)); year <= Number(toMonth.slice(0, 4)); year++) {
      const zip = path.join(dir, `${year}.zip`);
      if (!(await downloadArchive(year, zip))) {
        console.log(`No archive for ${year}; skipped.`);
        continue;
      }
      const reader = new FrArchiveReader(fromMonth, toMonth);
      await readArchive(zip, reader);
      rmSync(zip, { force: true });
      const p = frMonthlyRows(reader.months);
      console.log(`${year}: ${p.length} months, ${p.reduce((n, x) => n + x.rows.length, 0)} rows`);
      periods.push(...p);
      await new Promise((r) => setTimeout(r, 3000)); // be gentle with the publisher
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    currency: "EUR",
    unit: "per litre",
    periods,
    note: "Monthly figures from the Ministry's yearly price archives: for each station and fuel the last price posted in the month, then the median and 10th-90th percentile across stations (posted pump prices, not receipts). France as a whole (ALL) is metropolitan France only.",
  };
}
