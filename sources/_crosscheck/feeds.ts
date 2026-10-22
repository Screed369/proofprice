// Publisher readers for the outside check (crossCheck, see lib/crosscheck.ts). Shared by the wave-1 manifests: one pure parser per
// official file plus a tiny fetch wrapper that uses ctx.get (one plain GET, honest user agent, retried, memoised per run).
// Not a source (the folder starts with "_"), never imported by a route. Formats checked live through the GitHub probe on 22 Oct 2026:
//   probes/xc-wob.txt            EU Weekly Oil Bulletin price history (xlsx, 4.5 MB): ES/FR/IT/NL columns, bulletin of 19 Oct 2026
//   probes/xc-eia-56a-html.txt   EIA Electric Power Monthly table 5.6.A web page (HTML, 106 KB), July 2026
//   probes/xc-cso-hpm07.txt      CSO PxStat HPM07 (JSON-stat 2.0, 3.4 MB), months to August 2026
//   probes/xc-hpi-avg-csv.txt    UK HPI Average-prices-2026-08.csv (7.6 MB) and probes/xc-hpi-sales-csv.txt Sales-2026-08.csv (5.5 MB)
// The Land Registry SPARQL and linked-data endpoints answered 403 from GitHub on 22 Oct 2026, so the UK HPI is read from its
// monthly CSV downloads instead.

import type { CrossCheckContext, CrossCheckHeadline } from "../../lib/plugin";
import { SourceError } from "../../lib/http";
import { parseJsonStat, rowsWhere } from "../../lib/adapters/jsonstat";
import { readXlsx } from "../../categories/rent/xlsx";
import { HISTORY_URL as WOB_HISTORY_URL, PAGE_URL as WOB_PAGE_URL, parseHistory, type BulletinFuel } from "../eu-oil-bulletin/source";
import { stateKey } from "../us-eia-energy/source";

// ---------- EU Weekly Oil Bulletin ----------

export const WOB_URL = WOB_HISTORY_URL;
export const WOB_PAGE = WOB_PAGE_URL;

/** Headlines "<CC>/<fuel>" for the newest bulletin week, euro per litre, period = the bulletin's Monday. Pure. */
export function wobHeadlines(rows: Parameters<typeof parseHistory>[0], countries: string[], fuels: BulletinFuel[]): CrossCheckHeadline[] {
  const [w0] = parseHistory(rows, 2, 15);
  const out: CrossCheckHeadline[] = [];
  for (const cc of countries) {
    for (const f of fuels) {
      const v = w0.prices[cc]?.[f];
      if (v !== undefined) out.push({ key: `${cc}/${f}`, value: v, period: w0.date });
    }
  }
  return out;
}

export async function fetchWob(ctx: CrossCheckContext, countries: string[], fuels: BulletinFuel[]): Promise<CrossCheckHeadline[]> {
  const buf = (await ctx.get(WOB_URL, "binary"))!;
  const sheet = readXlsx(buf, { maxRows: 20 }).find((s) => s.rows.some((r) => r.some((c) => typeof c === "string" && /_price_with_tax_euro95$/.test(c.trim()))));
  if (!sheet) throw new SourceError("The Oil Bulletin workbook has no 'Prices with taxes' sheet any more.");
  return wobHeadlines(sheet.rows, countries, fuels);
}

// ---------- EIA Electric Power Monthly, table 5.6.A (the web page, a different route from the Excel file our collector reads) ----------

export const EIA_56A_PAGE = "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface Eia56a {
  month: string; // "2026-07"
  /** state code -> cents per kWh for the newest month, by sector */
  residential: Map<string, number>;
  commercial: Map<string, number>;
  industrial: Map<string, number>;
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Read the HTML table. The first data column of each sector is the newest month (header "July 2026"). Pure. */
export function parseEia56aHtml(html: string): Eia56a {
  const sectors = [...html.matchAll(/<th[^>]*colspan="2"[^>]*>([^<]*)<\/th>/g)].map((m) => text(m[1]).toLowerCase());
  if (sectors.slice(0, 3).join("|") !== "residential|commercial|industrial") {
    throw new SourceError(`EIA table 5.6.A has new column groups (${sectors.join(", ") || "none"}); the outside check needs updating.`);
  }
  const head = /<th[^>]*scope="col">\s*([A-Z][a-z]+) (\d{4})\s*<\/th>/.exec(html);
  const mi = head ? MONTHS.indexOf(head[1].toLowerCase()) : -1;
  if (!head || mi < 0) throw new SourceError("EIA table 5.6.A: no month heading such as 'July 2026'.");
  const out: Eia56a = { month: `${head[2]}-${String(mi + 1).padStart(2, "0")}`, residential: new Map(), commercial: new Map(), industrial: new Map() };
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (cells.length < 7) continue;
    const key = stateKey(cells[0]);
    if (!key || key === "ALL") continue;
    const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined);
    const [r, c, i] = [num(cells[1]), num(cells[3]), num(cells[5])];
    if (r !== undefined) out.residential.set(key, r);
    if (c !== undefined) out.commercial.set(key, c);
    if (i !== undefined) out.industrial.set(key, i);
  }
  if (out.residential.size < 40) throw new SourceError(`EIA table 5.6.A: only ${out.residential.size} states read; the page layout may have changed.`);
  return out;
}

export async function fetchEia56a(ctx: CrossCheckContext, sector: "residential" | "commercial", states: string[]): Promise<CrossCheckHeadline[]> {
  const t = parseEia56aHtml((await ctx.get(EIA_56A_PAGE, "text"))!);
  return states.filter((s) => t[sector].has(s)).map((s) => ({ key: s, value: t[sector].get(s)!, period: t.month }));
}

// ---------- CSO Ireland, PxStat HPM07 (rolling 12-month median, market-based household purchases) ----------

export const CSO_HPM07_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/HPM07/JSON-stat/2.0/en";
export const CSO_HPM07_PAGE = "https://data.cso.ie/table/HPM07";

/** Headlines by RPPI region code ("40" = Dublin): HPM07C02 (moving 12-month median), Existing dwellings ("02"), Filings ("01"),
 *  all buyer types ("-"), for the newest month. Pure. */
export function csoHpm07Headlines(json: unknown, regions: string[]): CrossCheckHeadline[] {
  const t = parseJsonStat(json);
  const time = t.ids.find((d) => /^TLIST/.test(d));
  const status = t.ids.find((d) => /Dwelling Status/i.test(t.dimensionLabels[d] ?? ""));
  const event = t.ids.find((d) => /Stamp Duty Event/i.test(t.dimensionLabels[d] ?? ""));
  const region = t.ids.find((d) => /RPPI Region/i.test(t.dimensionLabels[d] ?? ""));
  const buyer = t.ids.find((d) => /Type of Buyer/i.test(t.dimensionLabels[d] ?? ""));
  if (!time || !status || !event || !region || !buyer || !t.codes.STATISTIC?.includes("HPM07C02")) {
    throw new SourceError("CSO HPM07 has a new layout (dimensions or the median statistic HPM07C02 changed); the outside check needs updating.");
  }
  if (t.labels[status]["02"] !== "Existing" || t.labels[event]["01"] !== "Filings") throw new SourceError("CSO HPM07: the codes for Existing or Filings changed.");
  const rows = rowsWhere(t, { STATISTIC: "HPM07C02", [status]: "02", [event]: "01", [buyer]: "-", [region]: regions });
  const out: CrossCheckHeadline[] = [];
  for (const code of regions) {
    const mine = rows.filter((r) => r[region] === code && typeof r.value === "number").sort((a, b) => String(b[time]).localeCompare(String(a[time])));
    if (!mine.length) continue;
    const m = String(mine[0][time]);
    out.push({ key: code, value: mine[0].value as number, period: `${m.slice(0, 4)}-${m.slice(4, 6)}` });
  }
  return out;
}

export async function fetchCsoHpm07(ctx: CrossCheckContext, regions: string[]): Promise<CrossCheckHeadline[]> {
  return csoHpm07Headlines(JSON.parse((await ctx.get(CSO_HPM07_URL, "text"))!), regions);
}

// ---------- UK House Price Index, monthly CSV downloads (HM Land Registry) ----------

export const UK_HPI_BASE = "https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/";
export const UK_HPI_PAGE = "https://www.gov.uk/government/collections/uk-house-price-index-reports";
export const ukHpiUrl = (file: "Average-prices" | "Sales", release: string) => `${UK_HPI_BASE}${file}-${release}.csv`;

/** The newest Average_Price per area code ("E08000035" = Leeds), period "YYYY-MM". Pure. */
export function parseUkHpiAverages(csv: string, codes: string[]): Map<string, { value: number; period: string }> {
  const lines = csv.split(/\r?\n/);
  const head = lines[0]?.split(",").map((h) => h.trim());
  const [iDate, iCode, iPrice] = ["Date", "Area_Code", "Average_Price"].map((h) => head?.indexOf(h) ?? -1);
  if (iDate < 0 || iCode < 0 || iPrice < 0) throw new SourceError("UK HPI Average-prices CSV: columns Date, Area_Code or Average_Price missing.");
  const want = new Set(codes);
  const out = new Map<string, { value: number; period: string }>();
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    if (!want.has(c[iCode])) continue;
    const v = Number(c[iPrice]);
    const period = c[iDate].slice(0, 7);
    if (!Number.isFinite(v) || v <= 0 || !/^\d{4}-\d{2}$/.test(period)) continue;
    const had = out.get(c[iCode]);
    if (!had || period > had.period) out.set(c[iCode], { value: v, period });
  }
  return out;
}

/** Sales per month per area code: the mean of the newest `months` months that have a volume (volumes come in with a delay). Pure. */
export function parseUkHpiSales(csv: string, codes: string[], months = 3): Map<string, number> {
  const lines = csv.split(/\r?\n/);
  const head = lines[0]?.split(",").map((h) => h.trim());
  const [iDate, iCode, iVol] = ["Date", "Area_Code", "Sales_Volume"].map((h) => head?.indexOf(h) ?? -1);
  if (iDate < 0 || iCode < 0 || iVol < 0) throw new SourceError("UK HPI Sales CSV: columns Date, Area_Code or Sales_Volume missing.");
  const want = new Set(codes);
  const by = new Map<string, { period: string; v: number }[]>();
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    if (!want.has(c[iCode]) || c[iVol] === undefined || c[iVol].trim() === "") continue;
    const v = Number(c[iVol]);
    if (!Number.isFinite(v) || v <= 0) continue;
    (by.get(c[iCode]) ?? by.set(c[iCode], []).get(c[iCode])!).push({ period: c[iDate].slice(0, 7), v });
  }
  const out = new Map<string, number>();
  for (const [code, list] of by) {
    const newest = list.sort((a, b) => b.period.localeCompare(a.period)).slice(0, months);
    if (newest.length) out.set(code, Math.round(newest.reduce((s, x) => s + x.v, 0) / newest.length));
  }
  return out;
}

/** "YYYY-MM" months before now, newest first (the HPI release is named after its newest month, about two months back). */
export function recentReleases(now: Date, from = 1, to = 4): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function fetchUkHpi(ctx: CrossCheckContext, codes: string[]): Promise<CrossCheckHeadline[]> {
  for (const release of recentReleases(ctx.now)) {
    const avg = await ctx.get(ukHpiUrl("Average-prices", release), "text", { optional: true });
    if (avg === null) continue;
    const prices = parseUkHpiAverages(avg, codes);
    const salesCsv = await ctx.get(ukHpiUrl("Sales", release), "text", { optional: true });
    const sales = salesCsv ? parseUkHpiSales(salesCsv, codes) : new Map<string, number>();
    return codes.filter((c) => prices.has(c)).map((c) => ({ key: c, value: prices.get(c)!.value, period: prices.get(c)!.period, n: sales.get(c) ?? null }));
  }
  throw new SourceError(`No UK HPI release found for ${recentReleases(ctx.now).join(", ")} at ${UK_HPI_BASE}`);
}
