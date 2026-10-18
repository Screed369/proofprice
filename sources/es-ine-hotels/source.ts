// Spain hotel room prices: INE (Instituto Nacional de Estadistica) "Indicadores de Rentabilidad del Sector Hotelero" (operation IRSH),
// built from the monthly Hotel Occupancy Survey. The Average Daily Rate (ADR) is the average price actually charged per OCCUPIED room per night.
// Tempus JSON API, plain GET, no key, CORS open. Formats checked live on 2026-10-18 through the GitHub probe (fixtures.ts holds rows copied from them):
//   DATOS_TABLA/2059   ADR by autonomous community and province    (monthly from 2008; ?nult=1 = latest month, 34 KB)
//   DATOS_TABLA/46298  ADR by tourist site (cities, resorts)       (?nult=1, 53 KB)
//   DATOS_TABLA/2058   ADR national and by hotel star category     (?nult=1, 3.6 KB)
// A response is a JSON array of series: {COD, Nombre, FK_Unidad, Data:[{Fecha(epoch ms), FK_Periodo(month), Anyo, Valor, Secreto}]}.
// Series come in pairs: the value in euro (FK_Unidad 7, name ends "Datum." or "Data.") and the annual variation rate in percent (FK_Unidad 135).
// One small request per answer, no bulk file, no harvest needed: the API itself holds the monthly history back to 2008.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, retryOnce, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const API = "https://servicios.ine.es/wstempus/js/EN/DATOS_TABLA";
export const TABLE_REGIONS = 2059;
export const TABLE_SITES = 46298;
export const TABLE_STARS = 2058;
export const LICENCE_URL = "https://www.ine.es/dyngs/AYU/en/index.htm?cid=125";

export const INFO: SourceInfo = {
  id: "es-ine-hotels",
  country: "ES (Spain)",
  category: "hotels (average daily rate per occupied room)",
  name: "Hotel profitability indicators: average daily rate (ADR), monthly",
  publisher: "Instituto Nacional de Estadistica (INE), Spain",
  what_is_recorded:
    "The average daily rate (ADR): the average price actually charged per occupied hotel room per night, from INE's monthly hotel survey, for Spain, each autonomous community, province, tourist site and hotel star category. One published figure per area and month.",
  price_type: "official_statistic",
  freshness: "Monthly, published about six weeks after the month ends; every answer states its month. Monthly history back to 2008",
  licence: "INE legal notice: INE content may be reused, including commercially, under Creative Commons Attribution 4.0 (CC BY 4.0), crediting INE as the source and stating the date of the last update.",
  licence_url: LICENCE_URL,
  attribution:
    "Source: INE website (www.ine.es), Hotel profitability indicators (IRSH). Prepared by ProofPrice using data extracted from the INE website; figures are passed on as published. INE does not endorse ProofPrice.",
  homepage: "https://www.ine.es/dyngs/INEbase/en/operacion.htm?c=Estadistica_C&cid=1254736177109&menu=ultiDatos&idp=1254735576863",
  limits:
    "A monthly average over all hotels in the area (what hotels actually charged per occupied room), not a quote or booking price for particular dates, not asking prices, and not a range: INE gives one figure with no sample size, so the range fields are null. " +
    "Hotels only (no hostels, holiday rentals or camp sites). Star categories are published for Spain as a whole, not by area. Small areas can be missing in a month when INE suppresses the figure.",
};

// ---------- reading the API (pure) ----------

export type Kind = "value" | "variation";

export interface Series {
  code: string;
  /** Area name as INE writes it ("Andalucía", "Almería", "Alacant/Alicante", "National"). */
  area: string;
  /** 1 to 5 for the national star-category series, otherwise null. */
  stars: number | null;
  kind: Kind;
  year: number;
  month: number; // 1-12
  value: number;
}

const STAR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const VALUE_END = /(datum|data)\.?\s*$/i;
const VARIATION_END = /(interannual|annual) variation rate\.?\s*$/i;

/** Pull area name, star category and kind out of a series name. Null for series we do not use (other categories, other units). */
export function parseName(nombre: string): { area: string; stars: number | null; kind: Kind } | null {
  const name = nombre.trim();
  const kind: Kind | null = VALUE_END.test(name) ? "value" : VARIATION_END.test(name) ? "variation" : null;
  if (!kind) return null;
  const parts = name.split(".").map((s) => s.trim()).filter(Boolean);
  // "ADR. Andalucía. Datum."  /  "ADR. National. Datum."
  if (/^ADR$/i.test(parts[0]) && parts.length >= 3) return { area: parts[1], stars: null, kind };
  // "National. ADR. Five gold stars. Datum."
  if (parts.length >= 4 && /^ADR$/i.test(parts[1])) {
    const m = /^(one|two|three|four|five) gold stars?$/i.exec(parts[2]);
    if (m) return { area: parts[0], stars: STAR_WORDS[m[1].toLowerCase()], kind };
    return null;
  }
  // "Almería. Average Daily Rate (ADR). All categories. Data. "
  if (parts.length >= 4 && /^Average Daily Rate/i.test(parts[1])) {
    if (!/^All categories$/i.test(parts[2])) return null;
    return { area: parts[0], stars: null, kind };
  }
  return null;
}

/** Every usable series of a DATOS_TABLA response, each reduced to its latest data point. Euro values and percent variation rates only. */
export function parseTable(json: unknown): Series[] {
  if (!Array.isArray(json)) throw new SourceError("INE returned an unexpected answer (not a list of series); this source needs updating.");
  const out: Series[] = [];
  for (const s of json as any[]) {
    if (!s || typeof s.Nombre !== "string" || !Array.isArray(s.Data)) continue;
    const parsed = parseName(s.Nombre);
    if (!parsed) continue;
    if (parsed.kind === "value" && s.FK_Unidad !== 7) continue;
    if (parsed.kind === "variation" && s.FK_Unidad !== 135) continue;
    const points = (s.Data as any[]).filter((d) => d && !d.Secreto && typeof d.Valor === "number" && Number.isFinite(d.Valor) && Number.isInteger(d.Anyo) && d.FK_Periodo >= 1 && d.FK_Periodo <= 12);
    if (!points.length) continue;
    const latest = points.reduce((a, d) => (d.Anyo * 100 + d.FK_Periodo > a.Anyo * 100 + a.FK_Periodo ? d : a));
    out.push({ code: String(s.COD), ...parsed, year: latest.Anyo, month: latest.FK_Periodo, value: latest.Valor });
  }
  return out;
}

// ---------- matching a place name (pure) ----------

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();

const NATIONAL_WORDS = new Set(["", "spain", "espana", "es", "national", "nationwide", "all", "country"]);
export function isNational(area?: string): boolean {
  return NATIONAL_WORDS.has(norm(area ?? ""));
}

/** Names a series can be found under: the full name, the part before a comma ("Madrid, Comunidad de" -> "madrid") and each side of a slash ("Alacant/Alicante"). */
function aliases(name: string): string[] {
  const full = norm(name);
  const set = new Set<string>([full]);
  set.add(norm(name.split(",")[0]));
  for (const p of full.split(/[\/,]/)) if (p.trim()) set.add(p.trim());
  return [...set];
}

export interface AreaMatch {
  table: number;
  value: Series;
  variation: Series | null;
}

/** Find the value series (and its variation twin) for a place in the parsed tables. Exact name beats part-match; the region/province table beats the tourist-site table. */
export function findArea(tables: { id: number; series: Series[] }[], query: string): { match: AreaMatch; others: string[] } | null {
  const q = norm(query);
  const cands: { table: number; value: Series; rank: number }[] = [];
  for (const t of tables) {
    for (const s of t.series) {
      if (s.kind !== "value" || s.stars !== null || s.area.toLowerCase() === "national") continue;
      const al = aliases(s.area);
      let rank = 9;
      if (norm(s.area) === q) rank = 0;
      else if (al.includes(q)) rank = 1;
      else if (q.length >= 4 && al.some((a) => a.startsWith(q) || q.startsWith(a))) rank = 2;
      else if (q.length >= 4 && al.some((a) => a.includes(q))) rank = 3;
      if (rank < 9) cands.push({ table: t.id, value: s, rank });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.rank - b.rank || (a.table === TABLE_REGIONS ? -1 : 1) - (b.table === TABLE_REGIONS ? -1 : 1));
  const best = cands[0];
  // A loose (rank 2-3) match must be unambiguous, otherwise we would guess between places.
  if (best.rank >= 2) {
    const names = new Set(cands.filter((c) => c.rank === best.rank).map((c) => c.value.area));
    if (names.size > 1) return null;
  }
  const tableSeries = tables.find((t) => t.id === best.table)!.series;
  const variation = tableSeries.find((s) => s.kind === "variation" && s.area === best.value.area && s.stars === null) ?? null;
  const others = [...new Set(cands.filter((c) => c !== best && c.value.area !== best.value.area || (c !== best && c.table !== best.table)).map((c) => `${c.value.area} (${c.table === TABLE_REGIONS ? "region or province" : "tourist site"})`))].slice(0, 6);
  return { match: { table: best.table, value: best.value, variation }, others };
}

/** All places an area query can be, for error messages. */
export function placeNames(tables: { series: Series[] }[]): string[] {
  const names = new Set<string>();
  for (const t of tables) for (const s of t.series) if (s.kind === "value" && s.stars === null && s.area.toLowerCase() !== "national") names.add(s.area);
  return [...names];
}

// ---------- the answer ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const monthStart = (y: number, m: number) => `${ym(y, m)}-01`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const eur = (v: number) => `${v.toFixed(2)} euro`;

const METHOD =
  "INE (Spain's statistics office) surveys hotels every month and publishes the average daily rate (ADR): the average price actually charged per occupied room per night. " +
  "ProofPrice returns the published figure for the latest month, unchanged, with INE's annual change for the same month. " +
  "It is an average over all hotels in the area, not a range of individual bookings and not a quote for given dates; INE gives no sample size, so no range is calculated.";

export interface HotelReading {
  area: string;
  scope: "Spain" | "region, province or tourist site" | "Spain, by hotel star category";
  stars: number | null;
  value: Series;
  variation: Series | null;
  table: number;
  others?: string[];
}

export function hotelAnswer(r: HotelReading | null, q: { area?: string; stars?: number; baseUrl?: string; reason?: string }): PriceAnswer {
  const query: Record<string, unknown> = { country: "ES", ...(q.area && !isNational(q.area) ? { area: q.area } : {}), ...(q.stars ? { stars: q.stars } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per occupied room per night", method: METHOD, baseUrl: q.baseUrl };
  if (!r) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: q.reason ?? "INE publishes no hotel price for that place and month." };
  }
  const v = r.value;
  const label = monthLabel(v.year, v.month);
  const where = r.stars ? `${r.stars}-star hotels in Spain` : r.area === "National" ? "Spain" : r.area;
  const change = r.variation && r.variation.year === v.year && r.variation.month === v.month ? r.variation.value : null;
  const notes = ["Average price actually charged per occupied hotel room per night, as surveyed by INE (not a quote for particular dates, not a booking price)."];
  if (r.others?.length) notes.push(`Other places with a similar name: ${r.others.join("; ")}.`);
  return buildStatisticAnswer({
    ...base,
    value: v.value,
    period: { from: monthStart(v.year, v.month), to: monthEnd(v.year, v.month) },
    reference_period: ym(v.year, v.month),
    note: notes.join(" "),
    describe: (x) =>
      `In ${label} ${r.stars ? where : `hotels in ${where}`} charged an average of ${eur(x)} per occupied room per night (INE average daily rate).` +
      (change !== null ? (change === 0 ? " That is unchanged from a year earlier." : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${MONTHS[v.month - 1]} ${v.year - 1}.`) : ""),
    extra: {
      area: r.area === "National" ? "Spain" : r.area,
      scope: r.scope,
      ...(r.stars ? { hotel_stars: r.stars } : {}),
      month: ym(v.year, v.month),
      change_on_year_earlier_percent: change,
      price_basis: "average price charged per occupied room per night (official statistic)",
      ine_series: v.code,
      ine_table: r.table,
    },
  });
}

// ---------- fetch ----------

export interface FetchOpts {
  /** Replace the network call in tests. */
  get?: (url: string) => Promise<unknown>;
}

const getJson = (url: string, o: FetchOpts) => (o.get ? o.get(url) : retryOnce(() => fetchJson(url, {}, 15000)));
const tableUrl = (id: number) => `${API}/${id}?nult=1`;

export interface HotelInput {
  area?: string;
  stars?: number;
  baseUrl?: string;
}

export function pickStars(series: Series[], stars: number): HotelReading | null {
  const value = series.find((s) => s.kind === "value" && s.stars === stars);
  if (!value) return null;
  const variation = series.find((s) => s.kind === "variation" && s.stars === stars) ?? null;
  return { area: "National", scope: "Spain, by hotel star category", stars, value, variation, table: TABLE_STARS };
}

export function pickNational(series: Series[]): HotelReading | null {
  const value = series.find((s) => s.kind === "value" && s.stars === null && s.area.toLowerCase() === "national");
  if (!value) return null;
  const variation = series.find((s) => s.kind === "variation" && s.stars === null && s.area.toLowerCase() === "national") ?? null;
  return { area: "National", scope: "Spain", stars: null, value, variation, table: TABLE_REGIONS };
}

export async function esHotels(input: HotelInput, o: FetchOpts = {}): Promise<PriceAnswer> {
  const area = input.area?.trim();
  if (input.stars !== undefined) {
    if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new InputError("stars must be a whole number from 1 to 5.");
    if (area && !isNational(area)) throw new InputError("Not yet: INE publishes star categories for Spain as a whole only. Use stars on its own (national figure) or area on its own.");
    const series = parseTable(await getJson(tableUrl(TABLE_STARS), o));
    return hotelAnswer(pickStars(series, input.stars), { stars: input.stars, baseUrl: input.baseUrl, reason: `INE publishes no ${input.stars}-star hotel price for the latest month.` });
  }
  if (!area || isNational(area)) {
    const series = parseTable(await getJson(tableUrl(TABLE_REGIONS), o));
    return hotelAnswer(pickNational(series), { baseUrl: input.baseUrl, reason: "INE publishes no national hotel price for the latest month." });
  }
  const [regions, sites] = await Promise.all([getJson(tableUrl(TABLE_REGIONS), o), getJson(tableUrl(TABLE_SITES), o)]);
  const tables = [
    { id: TABLE_REGIONS, series: parseTable(regions) },
    { id: TABLE_SITES, series: parseTable(sites) },
  ];
  const found = findArea(tables, area);
  if (!found) {
    const names = placeNames(tables);
    throw new InputError(
      `Give a region, province or city that INE publishes, or leave area out for Spain. Not found: "${area}". Examples: ${names.slice(0, 12).join(", ")}${names.length > 12 ? `, and ${names.length - 12} more` : ""}.`,
    );
  }
  const { match, others } = found;
  return hotelAnswer(
    { area: match.value.area, scope: "region, province or tourist site", stars: null, value: match.value, variation: match.variation, table: match.table, others },
    { area, baseUrl: input.baseUrl },
  );
}
