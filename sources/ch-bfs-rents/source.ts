// Switzerland: average net rent of tenant and co-operative homes by canton and length of tenancy, from the Federal Statistical
// Office (BFS) Strukturerhebung (a yearly survey of residents) joined to the building and dwelling register. Table T 09.03.03.64,
// one small workbook (about 40 KB, one sheet per year, newest first). Format checked live on 2026-10-29 (workbook "je-d-09.03.03.64",
// sheets 2024 ... 2020, last modified 2026-02-09). Small enough to read per request; the answer is kept for 12 hours in memory.
//
// Sheet layout (German): rows "Schweiz" then the 26 cantons; columns = Total, then Neubau (dwelling not older than 2 years),
// Neubezug einer mehr als zwei Jahre alten Wohnung (new let of an older dwelling), then tenancies of 2-5, 6-10, 11-20 and 21+ years;
// each column is "average rent" followed by "confidence interval +-" (CHF a month). "X" = fewer than 5 observations (not published).
import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readXlsx, Sheet } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const ASSET_URL = "https://dam-api.bfs.admin.ch/hub/api/dam/assets/36398542/master";
export const DATASET_URL = "https://www.bfs.admin.ch/asset/de/je-d-09.03.03.64";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "ch-bfs-rents",
  country: "CH (Switzerland)",
  category: "rent (official rent statistics)",
  name: "Average rent by length of tenancy and canton (BFS Strukturerhebung)",
  publisher: "Federal Statistical Office (BFS), Switzerland",
  what_is_recorded:
    "The average monthly net rent in Swiss francs (without heating and service charges) of homes rented by tenants and co-operative members, for Switzerland and each canton, in total and by how long the household has lived in the home (new build, new let of an older home, 2-5, 6-10, 11-20, 21 or more years), with the confidence interval. Built from a survey of residents aged 15 and over linked to the building and dwelling register.",
  price_type: "official_statistic",
  freshness: "Yearly; the latest year published is 2024 (published in early 2026)",
  licence:
    "opendata.swiss terms 'open use, for commercial use ask permission of the data owner' (BFS). Commercial use is not cleared, so this source is a free-tier source: no charge is ever made for it.",
  licence_url: "https://opendata.swiss/en/terms-of-use",
  attribution: "Source: Federal Statistical Office (BFS), Strukturerhebung, table T 09.03.03.64 (average rent by length of tenancy and canton).",
  homepage: DATASET_URL,
  limits:
    "One published average per canton, tenancy length and year: no range from individual rents and no record count (a confidence interval is given). Rents of existing and new tenancies of tenants and co-operative members, net of heating and service charges. Cantons only, no towns or postcodes; the number of rooms is not in this table. Yearly, so about a year behind. Figures built from fewer than 5 observations are not published and give no answer.",
};

export const TENANCIES = [
  { key: "any", col: 1, label: "all tenancies", words: ["any", "all", "total"] },
  { key: "new_build", col: 3, label: "new-build homes (not older than 2 years)", words: ["new build", "newbuild", "new construction", "neubau"] },
  { key: "new_let", col: 5, label: "new lets of homes older than 2 years", words: ["new let", "new lets", "new tenancy", "new tenancies", "newly let", "neubezug"] },
  { key: "2_5y", col: 7, label: "households living there 2 to 5 years", words: ["2 5 years", "2 to 5 years", "2 5", "2 5y"] },
  { key: "6_10y", col: 9, label: "households living there 6 to 10 years", words: ["6 10 years", "6 to 10 years", "6 10", "6 10y"] },
  { key: "11_20y", col: 11, label: "households living there 11 to 20 years", words: ["11 20 years", "11 to 20 years", "11 20", "11 20y"] },
  { key: "21plus", col: 13, label: "households living there 21 years or more", words: ["21 years or more", "21 plus", "21 years", "21", "21y"] },
] as const;
export type TenancyKey = (typeof TENANCIES)[number]["key"];

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function matchTenancy(raw: string | undefined): (typeof TENANCIES)[number] {
  if (raw === undefined || norm(raw) === "") return TENANCIES[0];
  const t = norm(raw);
  const hit = TENANCIES.find((x) => x.key.replace(/_/g, " ") === t || x.words.some((w) => norm(w) === t));
  if (!hit) throw new InputError("tenancy_length must be one of: any, new_build, new_let, 2_5y, 6_10y, 11_20y, 21plus (how long the household has lived in the home).");
  return hit;
}

export interface Cell {
  rent: number | null; // CHF a month; null when not published
  ci: number | null; // confidence interval +- CHF
}
export interface Row {
  name: string; // as in the sheet (German)
  cells: Record<TenancyKey, Cell>;
}
export interface Table {
  year: number;
  rows: Row[];
}

const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) && c > 0 ? c : null);

/** Read the newest year's sheet. */
export function parseTable(sheets: Sheet[], minRows = 20): Table {
  const years = sheets.map((s) => ({ s, y: /^\d{4}$/.test(s.name.trim()) ? Number(s.name.trim()) : 0 })).filter((x) => x.y > 0);
  if (!years.length) throw new SourceError("The BFS rent workbook has no sheet named by year; the file layout changed and this source needs updating.");
  years.sort((a, b) => b.y - a.y);
  const { s, y } = years[0];
  const start = s.rows.findIndex((r) => String(r[0] ?? "").trim() === "Schweiz");
  if (start < 0) throw new SourceError("The BFS rent sheet has no 'Schweiz' row; the layout changed and this source needs updating.");
  const rows: Row[] = [];
  for (const r of s.rows.slice(start)) {
    const name = String(r[0] ?? "").trim();
    if (!name) break;
    // a data row has a number in the Total column; footnotes (long text) end the table
    if (num(r[1]) === null) break;
    const cells = {} as Record<TenancyKey, Cell>;
    for (const t of TENANCIES) cells[t.key] = { rent: num(r[t.col]), ci: num(r[t.col + 1]) };
    rows.push({ name, cells });
  }
  if (rows.length < minRows) throw new SourceError(`Only ${rows.length} rows found in the BFS rent sheet (expected 27); the layout changed and this source needs updating.`);
  return { year: y, rows };
}

// ---------- places ----------

export const CANTONS: { de: string; code: string; names: string[] }[] = [
  { de: "Zürich", code: "ZH", names: ["zurich", "zuerich"] },
  { de: "Bern", code: "BE", names: ["berne"] },
  { de: "Luzern", code: "LU", names: ["lucerne"] },
  { de: "Uri", code: "UR", names: [] },
  { de: "Schwyz", code: "SZ", names: [] },
  { de: "Obwalden", code: "OW", names: [] },
  { de: "Nidwalden", code: "NW", names: [] },
  { de: "Glarus", code: "GL", names: [] },
  { de: "Zug", code: "ZG", names: [] },
  { de: "Freiburg", code: "FR", names: ["fribourg"] },
  { de: "Solothurn", code: "SO", names: ["soleure"] },
  { de: "Basel-Stadt", code: "BS", names: ["basel city", "basel stadt", "basel"] },
  { de: "Basel-Landschaft", code: "BL", names: ["basel country", "basel land", "basel landschaft"] },
  { de: "Schaffhausen", code: "SH", names: ["schaffhouse"] },
  { de: "Appenzell A.Rh.", code: "AR", names: ["appenzell ausserrhoden", "appenzell outer rhodes"] },
  { de: "Appenzell I.Rh.", code: "AI", names: ["appenzell innerrhoden", "appenzell inner rhodes"] },
  { de: "St.Gallen", code: "SG", names: ["st gallen", "saint gallen", "saint gall"] },
  { de: "Graubünden", code: "GR", names: ["graubunden", "grisons", "grigioni"] },
  { de: "Aargau", code: "AG", names: ["argovie"] },
  { de: "Thurgau", code: "TG", names: ["thurgovie"] },
  { de: "Tessin", code: "TI", names: ["ticino"] },
  { de: "Waadt", code: "VD", names: ["vaud"] },
  { de: "Wallis", code: "VS", names: ["valais", "vallese"] },
  { de: "Neuenburg", code: "NE", names: ["neuchatel"] },
  { de: "Genf", code: "GE", names: ["geneva", "geneve", "ginevra"] },
  { de: "Jura", code: "JU", names: [] },
];

/** The sheet name (German) of the canton the text means, or "Schweiz". */
export function matchCanton(text: string | undefined): string {
  const t = norm(text ?? "");
  if (!t || ["ch", "switzerland", "schweiz", "suisse", "svizzera", "swiss", "whole country", "national"].includes(t)) return "Schweiz";
  const hit = CANTONS.find((c) => norm(c.de) === t || c.code.toLowerCase() === t || c.names.includes(t));
  if (!hit) {
    throw new InputError(
      `'${text}' is not a Swiss canton. This source publishes rents by canton only (not towns or postcodes): ${CANTONS.map((c) => `${c.code} ${c.de}`).join(", ")}, or leave town out for Switzerland as a whole.`,
    );
  }
  return hit.de;
}

// ---------- answering ----------

export interface ChInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  bedrooms?: number;
  tenancy_length?: string;
  baseUrl?: string;
}

/** Pure: the answer for one canton and tenancy length from the parsed table. */
export function chAnswer(table: Table, input: ChInput, now = new Date()): PriceAnswer {
  if (input.bedrooms !== undefined) throw new InputError("This BFS table does not split rents by number of rooms or bedrooms; leave bedrooms out (you can choose tenancy_length instead).");
  if (input.property_type !== undefined && input.property_type !== "any") throw new InputError("This BFS table does not split rents by property type; leave property_type out.");
  if (input.postcode && !input.town) throw new InputError("The BFS publishes rents by canton, not by postcode. Give the canton (for example Zürich, Geneva, Ticino) in town, or leave it out for Switzerland.");
  const name = matchCanton(input.town);
  const ten = matchTenancy(input.tenancy_length);
  const row = table.rows.find((r) => r.name === name);
  if (!row) throw new SourceError(`The BFS table has no row for ${name}; the layout may have changed.`);
  const cell = row.cells[ten.key];
  const display = name === "Schweiz" ? "Switzerland" : `canton ${name}`;
  const ageYears = now.getUTCFullYear() - table.year;
  const comparison: Record<string, number | null> = {};
  for (const t of TENANCIES) comparison[t.key] = row.cells[t.key].rent;
  const swiss = table.rows.find((r) => r.name === "Schweiz")!.cells[ten.key].rent;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "CH", town: name === "Schweiz" ? null : name, tenancy_length: ten.key },
    value: cell.rent,
    measure: "average",
    currency: "CHF",
    unit: "per month",
    period: { from: `${table.year}-01-01`, to: `${table.year}-12-31` },
    reference_period: String(table.year),
    method:
      "Switzerland (BFS Strukturerhebung): the average monthly net rent of tenant and co-operative homes published by the Federal Statistical Office for the canton, length of tenancy and year, without heating and service charges. We pass on the published average; it comes from a survey of residents linked to the building and dwelling register. An average with a confidence interval, not a range built from individual rents.",
    describe: (v) =>
      `The average monthly net rent (without heating and service charges) for ${ten.label} in ${display} was ${fmtMoney(v, "CHF")} in ${table.year}` +
      (cell.ci ? `, give or take ${fmtMoney(cell.ci, "CHF")} (confidence interval)` : "") +
      ". A survey average over existing and new tenancies of tenants and co-operative members, about a year old; one published average, not a range.",
    note:
      cell.rent === null
        ? `The BFS does not publish this figure for ${display} (fewer than 5 observations).`
        : "Net rent without heating and service charges; a survey average, so it can sit below the rent of a tenancy starting today." +
          (ageYears >= 2 ? ` The latest year we hold is ${table.year}.` : ""),
    baseUrl: input.baseUrl,
    extra:
      cell.rent !== null
        ? {
            area: { name, kind: name === "Schweiz" ? "country" : "canton" },
            confidence_interval_chf: cell.ci,
            switzerland_same_tenancy: swiss,
            by_tenancy_length: comparison,
            rent_kind: "average net rent of tenant and co-operative homes (survey statistic, not asking rents)",
            coverage_note: "Cantons only; tenants and co-operative members; net of heating and service charges.",
          }
        : undefined,
  });
}

// ---------- fetching ----------

let cache: { at: number; table: Table } | null = null;
export const fetchOptions = { url: ASSET_URL, cacheMs: 12 * 3600 * 1000, retryDelayMs: 1500 };

/**
 * Patient download for the daily collector: 3 tries of 20 s. A live answer must not wait that long: see downloadLive.
 */
async function download(url: string, tries = 3): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, fetchOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not reach the official source (BFS): ${last}`);
}

// BFS's download host hangs (rather than refuses) from Vercel's cloud IPs: 3 x 20 s took 40 s to reach the library copy (smoke 7 Nov: CH rent STALE after 40.1 s).
// A live answer gets one budget of 8 s in total; a quick failure (5xx, reset) still gets one retry inside it. The collector keeps the patient download above.
export const LIVE_BUDGET_MS = 8000;
async function downloadLive(url: string, budgetMs = LIVE_BUDGET_MS): Promise<Buffer> {
  const started = Date.now();
  let last = "";
  for (let i = 0; i < 2; i++) {
    const left = budgetMs - (Date.now() - started);
    if (left < 2500) break;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(left) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.message ?? e);
    }
    if (i === 0) await new Promise((r) => setTimeout(r, Math.min(fetchOptions.retryDelayMs, 300)));
  }
  throw new SourceError(`Could not reach the official source (BFS): ${last || "timed out"}`);
}

export async function loadTable(now = Date.now(), live = true): Promise<Table> {
  if (cache && now - cache.at < fetchOptions.cacheMs) return cache.table;
  const buf = live ? await downloadLive(fetchOptions.url) : await download(fetchOptions.url);
  const table = parseTable(readXlsx(buf));
  cache = { at: now, table };
  return table;
}
export function clearCache(): void {
  cache = null;
}

export async function chRents(input: ChInput): Promise<PriceAnswer> {
  // validate cheap inputs first so a bad request never waits for the download
  matchCanton(input.town);
  matchTenancy(input.tenancy_length);
  return chAnswer(await loadTable(), input);
}

// ---------- daily collector (stale-if-error copy) ----------
// BFS publishes one workbook a year, but its download host sometimes times out from Vercel. Once a day the collector (GitHub Actions)
// stores the newest year's published average for Switzerland and every canton, for every tenancy length. Rows are dated by the last
// day of the reference year and n is NO_COUNT (BFS gives an average and a confidence interval, no record count), so the copy stands
// in for a live answer for up to 35 days after the last successful collection (referenceDates).

/** Library item key per tenancy length (readable: the stale answer prints it). */
export const HARVEST_ITEMS: Record<TenancyKey, string> = {
  any: "average net rent, all tenancies",
  new_build: "average net rent, new-build homes",
  new_let: "average net rent, new lets of older homes",
  "2_5y": "average net rent, tenancies of 2 to 5 years",
  "6_10y": "average net rent, tenancies of 6 to 10 years",
  "11_20y": "average net rent, tenancies of 11 to 20 years",
  "21plus": "average net rent, tenancies of 21 years or more",
};

/** Pure: one row per canton (code, "CH" for Switzerland) and tenancy length that BFS publishes. */
export function harvestFromTable(table: Table): HarvestResult {
  const rows: DailyRow[] = [];
  for (const r of table.rows) {
    const canton = CANTONS.find((c) => c.de === r.name);
    const area = r.name === "Schweiz" ? "CH" : canton?.code;
    if (!area) continue;
    for (const t of TENANCIES) {
      const v = r.cells[t.key].rent;
      if (v === null) continue; // fewer than 5 observations: not published
      rows.push({ area, item: HARVEST_ITEMS[t.key], n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!rows.some((r) => r.area === "CH")) throw new SourceError("The BFS table gave no figure for Switzerland to collect.");
  return {
    date: `${table.year}-12-31`,
    currency: "CHF",
    unit: "per month",
    rows,
    note: `BFS Strukturerhebung table T 09.03.03.64, year ${table.year}: average monthly net rent (without heating and service charges) of tenant and co-operative homes for Switzerland and ${new Set(rows.map((r) => r.area)).size - 1} cantons by length of tenancy. Published averages, not counts of records (BFS publishes no record count).`,
  };
}

export async function chHarvest(): Promise<HarvestResult> {
  clearCache();
  return harvestFromTable(await loadTable(Date.now(), false));
}

/** Library key for a request, or null when the copy cannot answer it (a bedroom or type split, a postcode, an unknown canton). */
export function chHistoryKey(p: { town?: string; postcode?: string; property_type?: string; bedrooms?: number; tenancy_length?: string }): { area: string; item: string; label: string } | null {
  if (p.bedrooms !== undefined && p.bedrooms !== null) return null;
  if (p.property_type !== undefined && p.property_type !== "any" && p.property_type.trim() !== "") return null;
  if (p.postcode && !p.town) return null;
  try {
    const name = matchCanton(p.town);
    const ten = matchTenancy(p.tenancy_length);
    const canton = CANTONS.find((c) => c.de === name);
    return name === "Schweiz"
      ? { area: "CH", item: HARVEST_ITEMS[ten.key], label: "Switzerland" }
      : { area: canton!.code, item: HARVEST_ITEMS[ten.key], label: `canton ${name}` };
  } catch {
    return null;
  }
}
