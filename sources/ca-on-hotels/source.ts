// Ontario (Canada) hotel room prices: Ministry of Tourism, Culture and Gaming "Hotel statistics" on the Ontario Data Catalogue (CKAN).
// One small XLSX per month and language (mtcs-hotel-statistics-en-<mon>-<yy>.xlsx, ~32 KB) with occupancy rate, average daily rate (ADR)
// and revenue per available room (RevPAR) by area. We read the newest English file per request (one 32 KB download, no harvest).
// Catalogue format checked 2026-10-23 by the Verifier (package_show hotel-statistics, 89 resources). The workbook layout is read by header
// text, not by fixed position; if the layout is not recognised the error says what the sheet looks like so a Builder can fix the reader.
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import { downloadFile } from "../../lib/gov-uk";
import { packageShowUrl, parsePackageShow, CkanResource } from "../../lib/adapters/ckan";
import { readXlsx, Cell, Sheet } from "../../categories/rent/xlsx";
import type { SourceInfo } from "../../lib/plugin";

export const SITE = "https://data.ontario.ca";
export const DATASET = "hotel-statistics";
export const LICENCE_URL = "https://www.ontario.ca/page/terms-use";

export const INFO: SourceInfo = {
  id: "ca-on-hotels",
  country: "CA (Canada, province of Ontario)",
  category: "hotels (average daily rate per occupied room)",
  name: "Ontario hotel statistics: average daily rate, monthly",
  publisher: "Ministry of Tourism, Culture and Gaming, Ontario (figures compiled by CBRE Limited)",
  what_is_recorded:
    "The average daily rate (ADR): average room revenue per occupied hotel room per night, published monthly with the occupancy rate and revenue per available room, for Ontario and its tourism areas.",
  price_type: "official_statistic",
  freshness: "Monthly, published about five weeks after the month ends; every answer states its month",
  licence: "Ontario.ca Terms of Use (the dataset's licence on the Ontario Data Catalogue). Commercial reuse is not separately confirmed, so this source is offered on the free tier only.",
  licence_url: LICENCE_URL,
  attribution: "Source: Ministry of Tourism, Culture and Gaming, Ontario, Hotel statistics (data.ontario.ca), used under the Ontario.ca Terms of Use; the workbook credits CBRE Limited as the source of the figures. Prepared by ProofPrice; figures are passed on as published.",
  homepage: "https://data.ontario.ca/dataset/hotel-statistics",
  limits:
    "A monthly average over the hotels in the area (what hotels charged per occupied room), not a quote or booking price for particular dates, not asking prices, and not a range: the Ministry gives one figure with no sample size, so the range fields are null. " +
    "Ontario only, not the rest of Canada. Hotels only.",
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------- finding the newest file ----------

export interface MonthFile { url: string; year: number; month: number }

/** "mtcs-hotel-statistics-en-nov-23.xlsx" -> { 2023, 11 }; also reads "November 2023" style names. */
export function monthOf(text: string): { year: number; month: number } | null {
  const t = text.toLowerCase();
  let m = /-([a-z]{3})[a-z]*-(\d{2})(?:\D|$)/.exec(t) ?? /([a-z]{3})[a-z]*[\s_-]+(20\d{2})/.exec(t);
  if (!m) return null;
  const mi = MON3.indexOf(m[1]);
  if (mi < 0) return null;
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { year: y, month: mi + 1 };
}

/** English XLSX files of the dataset, newest month first. */
export function monthFiles(resources: CkanResource[]): MonthFile[] {
  const out: MonthFile[] = [];
  for (const r of resources) {
    const isXlsx = r.format === "XLSX" || /\.xlsx(\?|$)/i.test(r.url);
    if (!isXlsx || !r.url) continue;
    const file = r.url.split("/").pop() ?? "";
    if (!/-en-/i.test(file) && !/english/i.test(r.name)) continue;
    const m = monthOf(file) ?? monthOf(r.name);
    if (m) out.push({ url: r.url, ...m });
  }
  return out.sort((a, b) => b.year - a.year || b.month - a.month);
}

// ---------- reading the workbook ----------

export interface AreaRow { area: string; adr: number; occupancy: number | null; revpar: number | null }

const clean = (c: Cell) => String(c ?? "").replace(/\s+/g, " ").trim();
const asNumber = (c: Cell): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const n = Number(String(c ?? "").replace(/[$,\s]/g, ""));
  return String(c ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Find the header row (the one that names the average daily rate) and return one row per area. */
export function parseHotelSheets(sheets: Sheet[]): AreaRow[] {
  for (const sheet of sheets) {
    for (let h = 0; h < Math.min(sheet.rows.length, 30); h++) {
      const row = sheet.rows[h].map(clean);
      const adrCol = row.findIndex((c) => /average daily rate|\badr\b/i.test(c));
      if (adrCol < 0) continue;
      const occCol = row.findIndex((c) => /occupancy/i.test(c));
      const revCol = row.findIndex((c) => /revpar|revenue per available/i.test(c));
      const labelCol = row.findIndex((c, i) => i !== adrCol && i !== occCol && i !== revCol && /region|area|destination|tourism|location|geograph|market|name/i.test(c));
      const lc = labelCol >= 0 ? labelCol : 0;
      const rows: AreaRow[] = [];
      for (const r of sheet.rows.slice(h + 1)) {
        const area = clean(r[lc] ?? null);
        const adr = asNumber(r[adrCol] ?? null);
        if (/^source\b/i.test(area)) break; // the CBRE credit line ends the table
        if (!area) continue; // blank separator rows between groups of areas
        if (adr === null || adr <= 0 || adr > 2000) continue;
        const occ = occCol >= 0 ? asNumber(r[occCol] ?? null) : null;
        const rev = revCol >= 0 ? asNumber(r[revCol] ?? null) : null;
        rows.push({ area, adr, occupancy: occ === null ? null : occ <= 1 ? Math.round(occ * 1000) / 10 : occ, revpar: rev });
      }
      if (rows.length) return rows;
    }
  }
  const look = sheets.slice(0, 3).map((s) => `${s.name}: ` + s.rows.slice(0, 6).map((r) => r.map(clean).filter(Boolean).join(" | ").slice(0, 160)).join(" // ")).join(" ## ");
  throw new SourceError(`Ontario hotel file layout not recognised (no 'average daily rate' column). Sheets seen: ${look}`.slice(0, 900));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const WHOLE = /^(ontario|province of ontario|total ontario|ontario total|total|province|all of ontario)$/;

/** Pick the row asked for: the Ontario-wide row when no area is given, else the best name match. */
export function pickArea(rows: AreaRow[], area?: string): { row: AreaRow | null; others: string[] } {
  const q = norm(area ?? "");
  if (!q || WHOLE.test(q)) {
    const whole = rows.find((r) => WHOLE.test(norm(r.area)));
    if (whole) return { row: whole, others: [] };
    if (!q) return { row: null, others: rows.map((r) => r.area) };
  }
  const alias: Record<string, string> = { toronto: "greater toronto area", gta: "greater toronto area", "niagara region": "other niagara region", kitchener: "kitchener waterloo cambridge guelph", waterloo: "kitchener waterloo cambridge guelph", guelph: "kitchener waterloo cambridge guelph" };
  let hits = rows.filter((r) => norm(r.area) === (alias[q] ?? q));
  if (!hits.length && q.length >= 3) hits = rows.filter((r) => norm(r.area).includes(q));
  if (hits.length === 1) return { row: hits[0], others: [] };
  return { row: null, others: (hits.length ? hits : rows).map((r) => r.area).slice(0, 25) };
}

// ---------- the answer ----------

const METHOD =
  "Ontario's Ministry of Tourism, Culture and Gaming publishes hotel statistics every month: occupancy, the average daily rate (ADR, room revenue per occupied room per night) and revenue per available room. " +
  "ProofPrice returns the published ADR for the newest month, unchanged. It is an average over the hotels in the area, not a range of individual bookings and not a quote for given dates; the Ministry gives no sample size, so no range is calculated.";

export const ymd = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export function hotelAnswer(row: AreaRow | null, f: MonthFile, q: { area?: string; baseUrl?: string; others?: string[] }): PriceAnswer {
  const query: Record<string, unknown> = { country: "CA", ...(q.area ? { area: q.area } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", unit: "per occupied room per night", method: METHOD, baseUrl: q.baseUrl };
  const period = { from: `${ymd(f.year, f.month)}-01`, to: monthEnd(f.year, f.month) };
  if (!row) {
    const none = buildStatisticAnswer({ ...base, value: null, period, reference_period: ymd(f.year, f.month), describe: () => "" });
    return { ...none, summary: `The Ontario hotel statistics for ${MONTH_NAMES[f.month - 1]} ${f.year} have no area called '${q.area ?? ""}'. Areas published: ${(q.others ?? []).join("; ") || "none"}.` };
  }
  const label = `${MONTH_NAMES[f.month - 1]} ${f.year}`;
  return buildStatisticAnswer({
    ...base,
    value: row.adr,
    period,
    reference_period: ymd(f.year, f.month),
    note: "Average room revenue per occupied hotel room per night, as published by the Ontario Ministry of Tourism, Culture and Gaming (not a quote for particular dates).",
    describe: (x) =>
      `In ${label} hotels in ${row.area} earned an average of ${x.toFixed(2)} Canadian dollars per occupied room per night (Ontario Ministry of Tourism average daily rate)` +
      (row.occupancy !== null ? `, with ${row.occupancy}% of rooms occupied.` : "."),
    extra: { area: row.area, month: ymd(f.year, f.month), occupancy_percent: row.occupancy, revpar_cad: row.revpar, price_basis: "average daily rate per occupied room (official statistic)" },
  });
}

// ---------- fetch ----------

export interface FetchOpts {
  getJson?: (url: string) => Promise<unknown>;
  getFile?: (url: string) => Promise<Buffer>;
  /** Replace the workbook reader in tests. */
  readBook?: (buf: Buffer) => Sheet[];
}

export async function caHotels(input: { area?: string; baseUrl?: string }, o: FetchOpts = {}): Promise<PriceAnswer> {
  const area = input.area?.trim();
  if (area && area.length > 80) throw new InputError("area is too long: give an Ontario region or city such as 'Toronto' or 'Niagara'.");
  const url = packageShowUrl(SITE, DATASET);
  const json = o.getJson ? await o.getJson(url) : await retryOnce(() => fetchJson(url, {}, 15000));
  const files = monthFiles(parsePackageShow(json).resources);
  if (!files.length) throw new SourceError("The Ontario hotel statistics catalogue lists no English monthly workbook; this source needs updating.");
  let lastErr: unknown = null;
  for (const f of files.slice(0, 2)) {
    try {
      const buf = o.getFile ? await o.getFile(f.url) : await downloadFile(f.url, 5_000_000, 30000);
      const rows = parseHotelSheets((o.readBook ?? readXlsx)(buf));
      const { row, others } = pickArea(rows, area);
      return hotelAnswer(row, f, { area, baseUrl: input.baseUrl, others });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new SourceError("Could not read the Ontario hotel statistics.");
}
