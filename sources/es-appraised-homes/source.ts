// Spain: average APPRAISED value of free (non-protected) housing per m², from the Ministry of Transport / Housing's
// "Estadística de Valor Tasado de Vivienda" (mortgage appraisals by licensed appraisal companies). Two legacy .xls files on
// apps.fomento.gob.es (format checked live 2026-11-09): Table 1 (35101000.XLS: national, region and province, quarterly since 1995)
// and Table 5 (35103500.XLS: municipalities over 25,000 inhabitants, one sheet per quarter, with the number of appraisals).
// These are appraisal values, NOT prices paid in sales: the answer is an official statistic and says so everywhere.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readXls } from "./xls";

export const BASE = "https://apps.fomento.gob.es/BoletinOnline2/sedal/";
export const PROVINCE_URL = BASE + "35101000.XLS";
export const MUNICIPAL_URL = BASE + "35103500.XLS";
export const INDEX_URL = "https://apps.fomento.gob.es/BoletinOnline2/?nivel=2&orden=35000000";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "es-appraised-homes",
  country: "ES (Spain)",
  category: "home values (official average appraised value per m²)",
  name: "Valor tasado medio de vivienda libre: average appraised value of free housing, EUR per m², by region, province and municipality over 25,000 inhabitants",
  publisher: "Ministerio de Transportes y Movilidad Sostenible / Ministerio de Vivienda y Agenda Urbana (Estadística de Valor Tasado de Vivienda)",
  what_is_recorded:
    "Each quarter, the average value per m² that licensed appraisal companies put on free (non-protected) homes when valuing them for a mortgage, for Spain, its regions and provinces (since 1995) " +
    "and for municipalities with more than 25,000 inhabitants (with the number of appraisals). These are appraisals, not prices paid in sales. One published average per place and quarter; never an individual appraisal or address.",
  price_type: "official_statistic",
  freshness: "Quarterly, about five to six weeks after the quarter ends (the 2nd quarter 2026 tables were out in mid-September 2026); each answer states its quarter",
  licence:
    "Not confirmed: the ministry's data-licence pages (transportes.gob.es 'Licencia de datos abiertos', mivau.gob.es aviso legal) refused automated reading on 9 Nov 2026. Treated as free tier only, never charged for, until the licence is read and cleared. " +
    "The table files on apps.fomento.gob.es are served without any sign-in.",
  licence_url: "https://www.transportes.gob.es/el-ministerio/buen-gobierno/licencia_datos",
  attribution:
    "Fuente: Ministerio de Transportes y Movilidad Sostenible / Ministerio de Vivienda y Agenda Urbana, Estadística de Valor Tasado de Vivienda (Valor tasado medio de vivienda libre), quarter as stated in the answer. " +
    "Figures are passed on as published; the changes on the previous quarter and the year earlier are calculated by ProofPrice. This is not an endorsement by the ministry.",
  homepage: INDEX_URL,
  limits:
    "Appraisal values set for mortgage lending, not prices paid in sales, and they follow the homes that were appraised (mostly homes bought with a mortgage), so they can differ from recorded sale prices. " +
    "Free (non-protected) housing, all ages together. Price per m² of built area, not per home. Provinces and regions have no appraisal count in this table; municipalities over 25,000 inhabitants come with the number of appraisals and are left out when the ministry marks them 'not representative' (n.r) or when fewer than 5 appraisals stand behind them. " +
    "No figures for towns under 25,000 inhabitants or for postcodes.",
};

export type Fetcher = (url: string) => Promise<Buffer>;
export const defaultFetcher: Fetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    if (!res.ok) throw new SourceError(`The Spanish ministry's appraisal tables answered HTTP ${res.status}`, undefined, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`Could not reach the Spanish ministry's appraisal tables (${String(e?.cause?.code ?? e?.name ?? e?.message ?? e)})`);
  } finally {
    clearTimeout(timer);
  }
};
export interface FetchOptions {
  fetcher?: Fetcher;
  /** Tests: hand over an already parsed table instead of downloading and reading the workbook. */
  province?: () => Promise<ProvinceTable>;
  municipal?: () => Promise<MunicipalTable>;
}

// ---------- names (pure) ----------

export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every folded spelling of a name in the tables: "Coruña (A)" -> "coruna a", "a coruna", "coruna"; "Alicante/Alacant" -> both halves. */
export function nameKeys(raw: string): string[] {
  const clean = raw.replace(/\s+/g, " ").trim();
  const keys = new Set<string>([foldName(clean)]);
  const art = clean.match(/^(.*?)\s*\(\s*(El|La|Los|Las|A|O|As|Os)\s*\)\s*$/i);
  if (art) {
    keys.add(foldName(`${art[2]} ${art[1]}`));
    keys.add(foldName(art[1]));
  }
  const paren = clean.match(/^(.*?)\s*\([^)]*\)\s*$/);
  if (paren && paren[1]) keys.add(foldName(paren[1]));
  for (const part of clean.split("/")) if (part.trim()) keys.add(foldName(part));
  keys.delete("");
  return [...keys];
}

const ALIASES: Record<string, string> = {
  spain: "total nacional", espana: "total nacional", es: "total nacional", national: "total nacional", nacional: "total nacional", nationwide: "total nacional",
  "whole country": "total nacional", country: "total nacional", all: "total nacional", total: "total nacional",
  catalonia: "cataluna", catalunya: "cataluna", "balearic islands": "balears illes", baleares: "balears illes", "islas baleares": "balears illes", "illes balears": "balears illes",
  "canary islands": "canarias", "basque country": "pais vasco", euskadi: "pais vasco", "valencian community": "comunidad valenciana", "valencia region": "comunidad valenciana",
  "community of madrid": "madrid comunidad de", "comunidad de madrid": "madrid comunidad de", "region of murcia": "murcia region de", "la rioja": "rioja la",
  "las palmas": "palmas las", "santa cruz tenerife": "santa cruz de tenerife", tenerife: "santa cruz de tenerife", "gran canaria": "palmas las",
  "a coruna": "coruna a", "la coruna": "coruna a", corunna: "coruna a", seville: "sevilla", majorca: "balears illes", mallorca: "balears illes", ibiza: "balears illes",
  "castilla la mancha": "castilla la mancha", "castile and leon": "castilla y leon", "castilla leon": "castilla y leon", navarre: "navarra", asturias: "asturias principado de", cantabria: "cantabria",
  saragossa: "zaragoza", "ceuta and melilla": "ceuta y melilla",
};

// ---------- the province table (Table 1) ----------

export type Level = "national" | "region" | "province" | "region and province";
export interface Place {
  name: string; // as printed, cleaned
  level: Level;
  region: string | null;
  /** Value per quarter, oldest first (null = blank or n.r). */
  values: (number | null)[];
}
export interface Period { year: number; q: number }
export interface ProvinceTable {
  periods: Period[]; // one per quarter column, oldest first
  places: Place[];
  /** Index of the newest quarter the national row has a figure for. */
  latest: number;
}

const REGION_NAMES = new Set(
  ["Andalucía", "Aragón", "Asturias (Principado de )", "Balears (Illes)", "Canarias", "Cantabria", "Castilla y León", "Castilla-La Mancha", "Cataluña", "Comunidad Valenciana",
    "Extremadura", "Galicia", "Madrid (Comunidad de)", "Murcia (Región de)", "Navarra (Comunidad Foral de)", "País Vasco", "Rioja (La)", "Ceuta y Melilla"].map((s) => foldName(s)),
);
/** Regions that are a single province: the table prints one row for both. */
const SINGLE = new Set(["asturias principado de", "balears illes", "cantabria", "madrid comunidad de", "murcia region de", "navarra comunidad foral de", "rioja la"].map((s) => foldName(s)));

const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) && c > 0 ? c : null);

export function parseProvinceSheet(rows: unknown[][]): ProvinceTable {
  // Header: a row with "Año YYYY" cells, then a row with "1º 2º 3º 4º" cells.
  let yearRow = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) if ((rows[i] ?? []).some((c) => typeof c === "string" && /^Año\s+\d{4}$/.test(c.trim()))) { yearRow = i; break; }
  if (yearRow < 0) throw new SourceError("Unexpected layout in the Spanish appraisal table (no 'Año' header row)");
  const years: { col: number; year: number }[] = [];
  (rows[yearRow] ?? []).forEach((c, col) => {
    const m = typeof c === "string" ? c.trim().match(/^Año\s+(\d{4})$/) : null;
    if (m) years.push({ col, year: Number(m[1]) });
  });
  let qRow = -1;
  for (let i = yearRow + 1; i < yearRow + 4; i++) if ((rows[i] ?? []).some((c) => typeof c === "string" && /^[1-4]º/.test(c.trim()))) { qRow = i; break; }
  if (qRow < 0) throw new SourceError("Unexpected layout in the Spanish appraisal table (no quarter header row)");
  const cols: { col: number; p: Period }[] = [];
  (rows[qRow] ?? []).forEach((c, col) => {
    const m = typeof c === "string" ? c.trim().match(/^([1-4])º/) : null;
    if (!m) return;
    const y = [...years].reverse().find((yy) => yy.col <= col);
    if (y) cols.push({ col, p: { year: y.year, q: Number(m[1]) } });
  });
  if (!cols.length) throw new SourceError("Unexpected layout in the Spanish appraisal table (no quarter columns)");
  const places: Place[] = [];
  let region: string | null = null;
  for (let i = qRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const label = typeof r[1] === "string" ? r[1].replace(/\s+/g, " ").trim() : "";
    if (!label || /^n\.r/i.test(label)) continue;
    const values = cols.map((c) => num(r[c.col]));
    const key = foldName(label);
    let level: Level;
    if (key === "total nacional") { level = "national"; region = null; }
    else if (REGION_NAMES.has(key)) { level = SINGLE.has(key) ? "region and province" : "region"; region = label; }
    else level = "province";
    places.push({ name: label, level, region: level === "province" ? region : level === "national" ? null : label, values });
  }
  const national = places.find((p) => p.level === "national");
  if (!national) throw new SourceError("Spanish appraisal table has no national row");
  let latest = -1;
  national.values.forEach((v, i) => { if (v !== null) latest = i; });
  if (latest < 0) throw new SourceError("Spanish appraisal table has no national figure");
  return { periods: cols.map((c) => c.p), places, latest };
}

export function findPlace(table: ProvinceTable, query: string | undefined): Place | null {
  const q = foldName(query ?? "");
  if (!q || q === "total nacional") return table.places.find((p) => p.level === "national") ?? null;
  const wanted = ALIASES[q] ?? q;
  const hits = table.places.filter((p) => nameKeys(p.name).includes(wanted) || nameKeys(p.name).includes(q));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return hits.find((p) => p.level === "province") ?? hits[0];
  return null;
}

export const qLabel = (p: Period) => `${p.year}-Q${p.q}`;
const qEnd = (p: Period) => {
  const m = p.q * 3;
  return new Date(Date.UTC(p.year, m, 0)).toISOString().slice(0, 10);
};
const qStart = (p: Period) => new Date(Date.UTC(p.year, (p.q - 1) * 3, 1)).toISOString().slice(0, 10);
const pct = (a: number, b: number | null | undefined) => (typeof b === "number" && b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

// ---------- the municipal table (Table 5) ----------

export interface Municipality {
  province: string;
  name: string;
  total: number | null;
  upTo5: number | null;
  over5: number | null;
  count: number | null;
  countUpTo5: number | null;
  countOver5: number | null;
}
export interface MunicipalTable { period: Period; rows: Municipality[] }

export function parseMunicipalSheet(name: string, rows: unknown[][]): MunicipalTable {
  const m = name.match(/T\s*([1-4])\s*A\s*(\d{4})/i);
  if (!m) throw new SourceError(`Unexpected sheet name in the Spanish municipal appraisal table: ${name}`);
  let head = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) if ((rows[i] ?? []).some((c) => typeof c === "string" && c.trim() === "Municipio")) { head = i; break; }
  if (head < 0) throw new SourceError("Unexpected layout in the Spanish municipal appraisal table (no 'Municipio' header)");
  const sub = rows[head + 1] ?? [];
  const totals: number[] = [];
  sub.forEach((c, i) => { if (typeof c === "string" && c.trim() === "Total") totals.push(i); });
  if (totals.length < 2) throw new SourceError("Unexpected layout in the Spanish municipal appraisal table (value and count 'Total' columns not found)");
  const vTotal = totals[0], cTotal = totals[1];
  const out: Municipality[] = [];
  let province = "";
  for (let i = head + 2; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const mun = typeof r[2] === "string" ? r[2].replace(/\s+/g, " ").trim() : "";
    if (typeof r[1] === "string" && r[1].trim()) province = r[1].replace(/\s+/g, " ").trim();
    if (!mun) continue;
    out.push({
      province, name: mun,
      total: num(r[vTotal]), upTo5: num(r[vTotal - 2]), over5: num(r[vTotal - 1]),
      count: num(r[cTotal]), countUpTo5: num(r[cTotal - 2]), countOver5: num(r[cTotal - 1]),
    });
  }
  if (!out.length) throw new SourceError("The Spanish municipal appraisal table had no rows");
  return { period: { year: Number(m[2]), q: Number(m[1]) }, rows: out };
}

export function parseMunicipalWorkbook(buf: Buffer): MunicipalTable {
  const sheets = readXls(buf) as { name: string; rows: unknown[][] }[];
  const last = sheets.filter((s) => /T\s*[1-4]\s*A\s*\d{4}/i.test(s.name)).pop();
  if (!last) throw new SourceError("The Spanish municipal appraisal workbook has no quarter sheets");
  return parseMunicipalSheet(last.name, last.rows);
}

export function parseProvinceWorkbook(buf: Buffer): ProvinceTable {
  const sheets = readXls(buf) as { name: string; rows: unknown[][] }[];
  if (!sheets.length) throw new SourceError("The Spanish province appraisal workbook is empty");
  return parseProvinceSheet(sheets[sheets.length - 1].rows); // the newest years are on the last sheet
}

// ---------- answers ----------

const METHOD =
  "Spain: the average appraised value per m² of free (non-protected) housing that the Ministry of Transport / Housing publishes every quarter (Estadística de Valor Tasado de Vivienda) for Spain, its regions, provinces and municipalities over 25,000 inhabitants. " +
  "These are mortgage appraisals, not recorded sale prices. We pass on the published figure for the newest quarter, with the previous quarter and the year earlier (changes calculated by us); municipalities carry the number of appraisals and are left out below 5.";
const EVIDENCE = {
  label: "Official average appraised value (mortgage appraisals)",
  meaning: "The average value per m² that licensed appraisal companies put on homes when valuing them for a mortgage, published by the ministry. It is an appraisal, not a price paid in a sale and not an asking price.",
};
const NOTE_APPRAISED = "Appraised value per m² from mortgage valuations, not a price paid in sales.";

function checkInput(o: { postcode?: string; property_type?: string }) {
  if (o.postcode) throw new InputError("The Spanish ministry publishes appraised values by region, province and municipality (over 25,000 inhabitants), not by postcode. Give the province or municipality as town.");
  const t = (o.property_type ?? "any").trim().toLowerCase();
  if (t && t !== "any") throw new InputError("The Spanish appraisal tables cover free housing as a whole (not split by house or flat): leave property_type out or use 'any'.");
}

export function provinceAnswer(table: ProvinceTable, place: Place, baseUrl?: string): PriceAnswer {
  const i = table.latest;
  const cur = place.values[i];
  const period = table.periods[i];
  const prev = place.values[i - 1] ?? null;
  const yearAgo = place.values[i - 4] ?? null;
  const national = table.places.find((p) => p.level === "national")!;
  const nat = national.values[i];
  const where = place.level === "national" ? "Spain as a whole" : place.name;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "ES", town: place.level === "national" ? null : place.name, level: place.level },
    value: cur,
    measure: "average",
    currency: "EUR",
    unit: "per m² (appraised value)",
    period: { from: qStart(period), to: qEnd(period) },
    reference_period: qLabel(period),
    method: METHOD,
    baseUrl,
    evidence: EVIDENCE,
    note: NOTE_APPRAISED,
    describe: (v) =>
      `Mortgage appraisals put the average value of free housing in ${where} at ${fmtMoney(v, "EUR")} per m² in ${qLabel(period)}` +
      `${pct(v, prev) !== null ? `; ${pct(v, prev)}% on the previous quarter` : ""}${pct(v, yearAgo) !== null ? ` and ${pct(v, yearAgo)}% on a year earlier (our calculation)` : ""}. This is an appraised value, not a price paid in sales.`,
    extra: {
      price_basis: "appraised",
      level: place.level,
      region: place.region,
      previous_quarter: prev !== null ? { period: qLabel(table.periods[i - 1]), value: prev } : null,
      year_earlier: yearAgo !== null ? { period: qLabel(table.periods[i - 4]), value: yearAgo } : null,
      change_on_previous_quarter_pct: cur !== null ? pct(cur, prev) : null,
      change_on_year_earlier_pct: cur !== null ? pct(cur, yearAgo) : null,
      spain_average: place.level === "national" ? null : nat,
      versus_spain_pct: cur !== null && nat ? pct(cur, nat) : null,
      last_4_quarters: place.values.slice(Math.max(0, i - 3), i + 1).map((v, k) => ({ period: qLabel(table.periods[Math.max(0, i - 3) + k]), value: v })),
      appraisal_count: "not published for provinces and regions in this table; municipalities over 25,000 inhabitants carry counts",
    },
  });
}

export function municipalAnswer(table: MunicipalTable, query: string, baseUrl?: string): PriceAnswer {
  const wanted = foldName(query);
  const hits = table.rows.filter((r) => nameKeys(r.name).includes(wanted));
  if (!hits.length) {
    throw new InputError(`'${query}' is not a province, region or municipality over 25,000 inhabitants in the Spanish appraisal tables. Give a province (Madrid, Barcelona, Málaga, Valencia...), a larger municipality, or use town "Spain" for the national average.`);
  }
  if (hits.length > 1) {
    throw new InputError(`'${query}' matches municipalities in several provinces (${hits.map((h) => h.province).join(", ")}). Add the province, for example town "${query}, ${hits[0].province}".`);
  }
  const h = hits[0];
  const p = table.period;
  const enough = h.total !== null && h.count !== null && h.count >= 5;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "ES", town: h.name, province: h.province, level: "municipality" },
    value: enough ? h.total : null,
    measure: "average",
    currency: "EUR",
    unit: "per m² (appraised value)",
    period: { from: qStart(p), to: qEnd(p) },
    reference_period: qLabel(p),
    sample_size: enough ? h.count : null,
    method: METHOD,
    baseUrl,
    evidence: EVIDENCE,
    note: NOTE_APPRAISED,
    describe: (v) =>
      `Mortgage appraisals put the average value of free housing in ${h.name} (${h.province}) at ${fmtMoney(v, "EUR")} per m² in ${qLabel(p)}, from ${h.count} appraisals. This is an appraised value, not a price paid in sales.`,
    extra: {
      price_basis: "appraised",
      level: "municipality",
      province: h.province,
      appraisals: h.count,
      up_to_5_years_old: h.upTo5 !== null && (h.countUpTo5 ?? 0) >= 5 ? { value: h.upTo5, appraisals: h.countUpTo5 } : null,
      over_5_years_old: h.over5 !== null && (h.countOver5 ?? 0) >= 5 ? { value: h.over5, appraisals: h.countOver5 } : null,
      ...(enough ? {} : { withheld: "The ministry marks this municipality's figure not representative (n.r) or fewer than 5 appraisals stand behind it, so no figure is shown." }),
    },
  });
}

export async function esAppraisedHomes(o: { town?: string; postcode?: string; property_type?: string; level?: string; baseUrl?: string } & FetchOptions): Promise<PriceAnswer> {
  checkInput(o);
  const fetcher = o.fetcher ?? defaultFetcher;
  const loadProvince = o.province ?? (async () => parseProvinceWorkbook(await fetcher(PROVINCE_URL)));
  const loadMunicipal = o.municipal ?? (async () => parseMunicipalWorkbook(await fetcher(MUNICIPAL_URL)));
  const forceMunicipal = (o.level ?? "").toLowerCase() === "municipality";
  let query = (o.town ?? "").trim();
  // "Alcalá de Henares, Madrid": a province after a comma narrows a municipality.
  let provinceHint = "";
  if (query.includes(",")) {
    const [a, b] = query.split(",", 2);
    query = a.trim();
    provinceHint = foldName(b);
  }
  if (!forceMunicipal) {
    const table = await loadProvince();
    const place = findPlace(table, query);
    if (place && !provinceHint) return provinceAnswer(table, place, o.baseUrl);
  }
  if (!query) throw new InputError("Give a province or municipality as town.");
  const mt = await loadMunicipal();
  if (provinceHint) {
    const rows = mt.rows.filter((r) => foldName(r.province) === provinceHint || nameKeys(r.province).includes(provinceHint));
    return municipalAnswer({ ...mt, rows }, query, o.baseUrl);
  }
  return municipalAnswer(mt, query, o.baseUrl);
}

// ---------- daily collector (stale-if-error copy for regions and provinces) ----------

export const HARVEST_ITEM = "all:q";
const areaKey = (name: string) => foldName(name).replace(/ /g, "-");

export function harvestRows(table: ProvinceTable): HarvestResult {
  const i = table.latest;
  const period = table.periods[i];
  const rows: DailyRow[] = [];
  for (const p of table.places) {
    const v = p.values[i];
    if (v === null) continue;
    rows.push({ area: p.level === "national" ? "ES" : areaKey(p.name), item: HARVEST_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  return {
    date: qEnd(period),
    currency: "EUR",
    unit: "per m² (appraised value)",
    rows,
    note: `Estadística de Valor Tasado de Vivienda, Table 1: average appraised value of free housing per m² for ${qLabel(period)}, ${rows.length} places (Spain, regions, provinces). Published averages, not counts; appraised values, not prices paid.`,
  };
}

export async function esHarvest(o: FetchOptions = {}): Promise<HarvestResult> {
  const fetcher = o.fetcher ?? defaultFetcher;
  const table = o.province ? await o.province() : parseProvinceWorkbook(await fetcher(PROVINCE_URL));
  return harvestRows(table);
}

/** Library key: Spain, a region or a province (the table's own names). Null for municipalities and anything the copy cannot answer. */
export function esHistoryKey(p: { town?: string; postcode?: string; property_type?: string; level?: string }): { area: string; item: string; label: string } | null {
  if (p.postcode || (p.level ?? "").toLowerCase() === "municipality" || (p.town ?? "").includes(",")) return null;
  const t = (p.property_type ?? "any").trim().toLowerCase();
  if (t && t !== "any") return null;
  if (!p.town || !p.town.trim()) return { area: "ES", item: HARVEST_ITEM, label: "Spain" };
  const q = foldName(p.town);
  if (ALIASES[q] === "total nacional" || q === "total nacional") return { area: "ES", item: HARVEST_ITEM, label: "Spain" };
  return KNOWN_KEYS.get(ALIASES[q] ?? q) ?? null;
}

/** Province and region names as printed in Table 1 (stable for decades), so the key can be built without downloading the table. */
const NAMES = [
  "Andalucía", "Almería", "Cádiz", "Córdoba", "Granada", "Huelva", "Jaén", "Málaga", "Sevilla", "Aragón", "Huesca", "Teruel", "Zaragoza", "Asturias (Principado de )", "Balears (Illes)", "Canarias", "Palmas (Las)",
  "Santa Cruz de Tenerife", "Cantabria", "Castilla y León", "Ávila", "Burgos", "León", "Palencia", "Salamanca", "Segovia", "Soria", "Valladolid", "Zamora", "Castilla-La Mancha", "Albacete", "Ciudad Real", "Cuenca",
  "Guadalajara", "Toledo", "Cataluña", "Barcelona", "Girona", "Lleida", "Tarragona", "Comunidad Valenciana", "Alicante/Alacant", "Castellón/Castelló", "Valencia/València", "Extremadura", "Badajoz", "Cáceres",
  "Galicia", "Coruña (A)", "Lugo", "Ourense", "Pontevedra", "Madrid (Comunidad de)", "Murcia (Región de)", "Navarra (Comunidad Foral de)", "País Vasco", "Araba/Alava", "Gipuzkoa", "Bizkaia", "Rioja (La)",
  "Ceuta y Melilla", "Ceuta", "Melilla",
];
const KNOWN_KEYS: Map<string, { area: string; item: string; label: string }> = (() => {
  const m = new Map<string, { area: string; item: string; label: string }>();
  for (const n of NAMES) for (const k of nameKeys(n)) if (!m.has(k) || /\(|\//.test(n) === false) m.set(k, { area: areaKey(n), item: HARVEST_ITEM, label: n.replace(/\s+/g, " ").trim() });
  return m;
})();
