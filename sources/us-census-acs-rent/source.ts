// US rents from the Census Bureau's American Community Survey (ACS) 5-year estimates, table B25064: median gross rent
// (contract rent plus utilities) of renter-occupied units paying cash rent, with its margin of error, for the US, every state,
// every county, metro areas and cities of 50,000 or more people. Source files are the key-free "table-based summary files" on
// www2.census.gov (pipe-delimited .dat per table, one geography names file), formats checked live 2026-11-03 from GitHub's servers.
// The files are big (17 MB table, 87 MB names), so the daily collector reads them once (harvest) and requests are answered from
// the price library, never from the files.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-census-acs-rent",
  country: "US (United States)",
  category: "rent (official median rent paid by tenants)",
  name: "American Community Survey 5-year estimates, table B25064: median gross rent",
  publisher: "US Census Bureau",
  what_is_recorded:
    "The median gross rent (rent paid to the landlord plus the usual monthly cost of utilities and fuels) of renter-occupied homes that pay cash rent, from the Census Bureau's " +
    "American Community Survey, pooled over five years, for the United States, each state, each county, metro and micro areas, and cities and towns of 50,000 or more people. " +
    "One published median per area; never individual rents or addresses.",
  price_type: "official_statistic",
  freshness: "Yearly (new 5-year release each December); the release read on 3 Nov 2026 was 2020-2024",
  licence:
    "US Census Bureau statistics. The licence wording on census.gov was not read for this source, so it is served as a free tier only and is never charged.",
  licence_url: "https://www.census.gov/about/policies/open-gov/open-data.html",
  attribution:
    "Source: U.S. Census Bureau, American Community Survey 5-year estimates, table B25064 (https://www.census.gov/programs-surveys/acs). " +
    "This product uses Census Bureau data but is not endorsed or certified by the Census Bureau.",
  homepage: "https://www.census.gov/programs-surveys/acs",
  limits:
    "A survey estimate, not a count of leases: the median of what a sample of tenants reported, pooled over five years, so it lags today's new leases and is lower than listing rents. " +
    "Gross rent includes utilities. Estimates with a margin of error above 30% of the figure are not shown. Cities and towns of 50,000 or more people only; small places are covered by their county. " +
    "Rents above the survey's top code are published as the top code.",
};

export const BASE = "https://www2.census.gov/programs-surveys/acs/summary_file";
export const dataUrl = (year: number, table: string) => `${BASE}/${year}/table-based-SF/data/5YRData/acsdt5y${year}-${table}.dat`;
export const geosUrl = (year: number) => `${BASE}/${year}/table-based-SF/documentation/Geos${year}5YR.txt`;
export const ITEM = "gross";
export const MAX_MOE_SHARE = 0.3;
export const MIN_PLACE_POPULATION = 50000;

export type Kind = "national" | "state" | "county" | "place" | "metro";
const LEVEL: Record<string, Kind> = { "010": "national", "040": "state", "050": "county", "160": "place", "310": "metro" };

// ---------- pure parsers ----------

/** Split pipe-delimited text into rows; the first row is the header. */
export function parsePipe(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { header: [], rows: [] };
  return { header: lines[0].split("|"), rows: lines.slice(1).map((l) => l.split("|")) };
}

export interface Estimate { est: number; moe: number | null }

/** GEO_ID -> estimate and margin of error from a table file (columns GEO_ID|<T>_E001|<T>_M001). Blank and non-numeric cells are skipped. */
export function parseTable(lines: Iterable<string>, table: string): Map<string, Estimate> {
  const out = new Map<string, Estimate>();
  let ie = -1, im = -1, ig = -1, head = true;
  const T = table.toUpperCase();
  for (const line of lines) {
    if (!line) continue;
    const c = line.split("|");
    if (head) {
      head = false;
      ig = c.indexOf("GEO_ID");
      ie = c.indexOf(`${T}_E001`);
      im = c.indexOf(`${T}_M001`);
      if (ig < 0 || ie < 0) throw new SourceError(`Census table ${table} has a new layout (found: ${c.slice(0, 4).join(", ")})`);
      continue;
    }
    const est = Number(c[ie]);
    if (!c[ie] || !Number.isFinite(est) || est <= 0) continue;
    const m = im >= 0 && c[im] !== "" ? Number(c[im]) : NaN;
    out.set(c[ig], { est, moe: Number.isFinite(m) && m >= 0 ? m : null });
  }
  return out;
}

export interface Geo { id: string; name: string; kind: Kind }

/** Geographies of the kinds we keep, from the geography names file (whole-geography rows only, COMPONENT 00). */
export function parseGeos(lines: Iterable<string>): Geo[] {
  const out: Geo[] = [];
  let head = true, iS = -1, iC = -1, iG = -1, iN = -1;
  for (const line of lines) {
    if (!line) continue;
    const c = line.split("|");
    if (head) {
      head = false;
      iS = c.indexOf("SUMLEVEL"); iC = c.indexOf("COMPONENT"); iG = c.indexOf("GEO_ID"); iN = c.indexOf("NAME");
      if (iS < 0 || iC < 0 || iG < 0 || iN < 0) throw new SourceError("Census geography file has a new layout");
      continue;
    }
    const kind = LEVEL[c[iS]];
    if (!kind || c[iC] !== "00") continue;
    out.push({ id: c[iG], name: c[iN], kind });
  }
  return out;
}

/** The library key of an area: kind and Census name. The whole US is the library's usual ALL. */
export const areaKey = (g: Geo) => (g.kind === "national" ? NATIONAL : `${g.kind}:${g.name}`);

/** Library rows from estimates, dropping imprecise ones; places only when the area has at least MIN_PLACE_POPULATION people. */
export function buildRows(geos: Geo[], rent: Map<string, Estimate>, population: Map<string, Estimate>): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const g of geos) {
    const r = rent.get(g.id);
    if (!r) continue;
    if (g.kind === "place" && (population.get(g.id)?.est ?? 0) < MIN_PLACE_POPULATION) continue;
    if (r.moe !== null && r.moe / r.est > MAX_MOE_SHARE) continue;
    rows.push({ area: areaKey(g), item: ITEM, n: NO_COUNT, median: r.est, low: r.est, high: r.est, min: r.est, max: r.est });
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area));
}

// ---------- places ----------

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface Area { key: string; kind: Kind; name: string; base: string; state: string; abbrs: string[] }

const PLACE_SUFFIX = /\s+(city and borough|consolidated government \(balance\)|metropolitan government \(balance\)|unified government \(balance\)|urban county|municipality|city|town|village|borough|CDP|\(balance\))$/i;
const COUNTY_SUFFIX = /\s+(County|Parish|Borough|Census Area|Municipality|city and borough|Municipio)$/i;

/** Read the library area keys into searchable areas. */
export function areasOf(keys: string[]): Area[] {
  const out: Area[] = [];
  for (const key of keys) {
    if (key === NATIONAL) { out.push({ key, kind: "national", name: "United States", base: "United States", state: "", abbrs: [] }); continue; }
    const i = key.indexOf(":");
    const kind = key.slice(0, i) as Kind;
    const name = key.slice(i + 1);
    if (kind === "state") { out.push({ key, kind, name, base: name, state: name, abbrs: [] }); continue; }
    if (kind === "metro") {
      const m = /^(.*), ([A-Z]{2}(?:-[A-Z]{2})*) (?:Metro|Micro) Area$/.exec(name);
      out.push({ key, kind, name, base: m ? m[1] : name, state: "", abbrs: m ? m[2].split("-") : [] });
      continue;
    }
    const j = name.lastIndexOf(", ");
    const head = j < 0 ? name : name.slice(0, j);
    const state = j < 0 ? "" : name.slice(j + 2);
    out.push({ key, kind, name, base: head.replace(kind === "county" ? COUNTY_SUFFIX : PLACE_SUFFIX, ""), state, abbrs: [] });
  }
  return out;
}

// A state name on its own ("Texas") is the state, even when several counties share the name; a single city of that name still wins ("Seattle").
const KIND_ORDER: Kind[] = ["place", "state", "county", "metro"];
const label = (a: Area) => (a.kind === "state" ? a.name : a.kind === "national" ? "the United States" : a.kind === "metro" ? a.name : `${a.base}${a.kind === "county" ? " County" : ""}, ${a.state}`);
const STATES_BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v, k]));

function stateOf(token: string): string | null {
  const t = token.trim();
  const up = t.toUpperCase();
  if (STATES[up]) return STATES[up];
  const f = fold(t);
  return Object.values(STATES).find((s) => fold(s) === f) ?? null;
}

/** Resolve "Seattle", "Portland, OR", "King County, Washington", "Texas" or nothing (the whole US). */
export function resolveArea(areas: Area[], town?: string): { area: Area; others: Area[] } {
  const raw = (town ?? "").trim();
  if (!raw) return { area: areas.find((a) => a.kind === "national")!, others: [] };
  let namePart = raw;
  let wantState: string | null = null;
  const comma = raw.lastIndexOf(",");
  if (comma > 0) {
    const s = stateOf(raw.slice(comma + 1));
    if (s) { wantState = s; namePart = raw.slice(0, comma); }
  }
  const key = fold(namePart.replace(PLACE_SUFFIX, "").replace(COUNTY_SUFFIX, ""));
  const wantAbbr = wantState ? STATES_BY_NAME[wantState] : null;
  const match = (a: Area): boolean => {
    if (a.kind === "national") return /^(us|usa|united states|america|national)$/.test(key);
    const first = a.kind === "metro" ? fold(a.base.split("-")[0]) : "";
    if (fold(a.base) !== key && !(a.kind === "metro" && first === key)) return false;
    if (!wantState) return true;
    return a.kind === "metro" ? !!wantAbbr && a.abbrs.includes(wantAbbr) : a.state === wantState;
  };
  const hits = areas.filter(match);
  if (!hits.length) throw notFound(raw, areas);
  for (const kind of KIND_ORDER) {
    const group = hits.filter((a) => a.kind === kind);
    if (group.length === 1) return { area: group[0], others: hits.filter((a) => a !== group[0]) };
    if (group.length > 1) {
      throw new InputError(
        `"${raw}" matches several ${kind === "place" ? "cities" : kind === "county" ? "counties" : "areas"} in the American Community Survey: ${group.slice(0, 8).map(label).join("; ")}. Add the state, e.g. "${label(group[0])}".`,
      );
    }
  }
  throw notFound(raw, areas);
}

function notFound(raw: string, areas: Area[]): InputError {
  const cities = areas.filter((a) => a.kind === "place").slice(0, 10).map((a) => label(a));
  return new InputError(
    `The Census Bureau's rent table has no area called "${raw}". It covers the United States, each state, counties, metro areas and cities of 50,000 or more people. ` +
      `Try a city with its state such as ${cities.slice(0, 5).join("; ")}, a county such as "King County, Washington", a state such as "Texas", or leave town out for the whole country.`,
  );
}

// ---------- the answer ----------

export interface AcsInput { town?: string; baseUrl?: string }

export function answerFrom(day: { date: string; rows: Array<{ area: string; median: number }> }, input: AcsInput): PriceAnswer {
  const areas = areasOf([...new Set(day.rows.map((r) => r.area))]);
  const { area, others } = resolveArea(areas, input.town);
  const row = day.rows.find((r) => r.area === area.key);
  if (!row) throw new SourceError("The Census rent figure for this area is missing from our copy");
  const year = Number(day.date.slice(0, 4));
  const where = label(area);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "US", town: input.town ?? "United States" },
    value: row.median,
    measure: "median",
    currency: "USD",
    unit: "per month",
    period: { from: `${year - 4}-01-01`, to: `${year}-12-31` },
    reference_period: `${year - 4}-${year} (5-year estimate)`,
    sample_size: null,
    method:
      "US (Census Bureau, American Community Survey 5-year estimates, table B25064): the median gross rent (rent plus utilities) reported by tenants paying cash rent in the chosen area, pooled over five years. " +
      "We pass on the published median; it is a survey estimate, not a range of individual rents, and it lags new leases.",
    describe: (x) => `The median gross rent (rent plus utilities) paid by tenants in ${where} was ${fmtMoney(x, "USD")} a month, averaged over the ${year - 4}-${year} survey years.`,
    note: "Survey estimate over five years that includes utilities; rents on new leases are usually higher.",
    baseUrl: input.baseUrl,
    extra: {
      area: { name: area.name.replace(/^.*?:/, ""), kind: area.kind },
      includes_utilities: true,
      ...(others.length ? { other_areas_with_this_name: others.slice(0, 5).map(label) } : {}),
    },
  });
}

export async function usRent(input: AcsInput): Promise<PriceAnswer> {
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice collects the Census rent tables daily; data appears after the next collection.");
  return answerFrom(day, input);
}

export function usRentHistoryKey(p: { town?: string }, keys?: string[]): { area: string; item: string; label: string } | null {
  try {
    const list = keys ?? [...new Set((readLatestDay(INFO.id)?.rows ?? []).map((r) => r.area))];
    if (!list.length) return null;
    const { area } = resolveArea(areasOf(list), p.town);
    return { area: area.key, item: ITEM, label: label(area) };
  } catch {
    return null;
  }
}

// ---------- daily collector ----------

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The newest 5-year release that exists (tries this year down to 2024). A release counts only when the table AND its
 *  geography file are both up: Census uploads them piecemeal, and on 11 Nov 2026 the 2025 table was there but Geos20255YR.txt was a 404. */
export async function newestYear(now = new Date(), exists: (url: string) => Promise<boolean> = headOk): Promise<number> {
  for (let y = now.getUTCFullYear(); y >= 2024; y--) if ((await exists(dataUrl(y, "b25064"))) && (await exists(geosUrl(y)))) return y;
  throw new SourceError("No ACS 5-year table B25064 found on www2.census.gov");
}

/** Read a big text file line by line without holding it in memory. */
export async function* streamLines(url: string, timeoutMs = 240000): AsyncGenerator<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "ProofPrice-collector (+https://proofprice.com; hello@proofprice.com)" } });
  if (!res.ok || !res.body) throw new SourceError(`Census file returned HTTP ${res.status}: ${url}`);
  const dec = new TextDecoder();
  let rest = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    rest += dec.decode(chunk, { stream: true });
    let i: number;
    let start = 0;
    while ((i = rest.indexOf("\n", start)) >= 0) { yield rest.slice(start, i).replace(/\r$/, ""); start = i + 1; }
    rest = rest.slice(start);
  }
  rest += dec.decode();
  if (rest) yield rest;
}

/** Collect the lines of a streamed file that `keep` accepts (the header line is always kept). */
export async function collectLines(lines: AsyncIterable<string>, keep: (cols: string[], header: string[]) => boolean): Promise<string[]> {
  const out: string[] = [];
  let header: string[] | null = null;
  for await (const line of lines) {
    if (!line) continue;
    const c = line.split("|");
    if (!header) { header = c; out.push(line); continue; }
    if (keep(c, header)) out.push(line);
  }
  return out;
}

/** Keep only the geography rows we use: the whole-geography (COMPONENT 00) rows of the kinds in LEVEL. */
export const keepGeo = (c: string[], h: string[]) => LEVEL[c[h.indexOf("SUMLEVEL")]] !== undefined && c[h.indexOf("COMPONENT")] === "00";

export async function usRentHarvest(): Promise<HarvestResult> {
  const year = await newestYear();
  const geoLines = await collectLines(streamLines(geosUrl(year)), keepGeo);
  const geos = parseGeos(geoLines);
  const rent = parseTable(await collectLines(streamLines(dataUrl(year, "b25064")), () => true), "b25064");
  const population = parseTable(await collectLines(streamLines(dataUrl(year, "b01003")), () => true), "b01003");
  return harvestFrom(year, geos, rent, population);
}

export function harvestFrom(year: number, geos: Geo[], rent: Map<string, Estimate>, population: Map<string, Estimate>): HarvestResult {
  const rows = buildRows(geos, rent, population);
  if (!rows.some((r) => r.area === NATIONAL)) throw new SourceError("Census table B25064 held no national median rent");
  if (rows.length < 500) throw new SourceError(`Census table B25064 gave only ${rows.length} usable areas; the layout may have changed`);
  return {
    date: `${year}-12-31`,
    currency: "USD",
    unit: "per month",
    rows,
    note: `US Census Bureau ACS ${year - 4}-${year} 5-year, table B25064 median gross rent: ${rows.length} areas (US, states, counties, metro areas, cities of ${MIN_PLACE_POPULATION}+ people), margin of error under ${MAX_MOE_SHARE * 100}% of the figure. Published medians, not counts of records.`,
  };
}
