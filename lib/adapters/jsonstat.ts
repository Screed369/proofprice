// JSON-stat 2.0 adapter, with helpers for Eurostat. JSON-stat is the cube format used by Eurostat and offered by many
// national statistics offices (PxWeb and PxStat based ones such as Statistics Norway and the CSO in Ireland).
// A dataset has ordered dimensions (id[], size[]), a category index per dimension, and one flat `value` list in
// row-major order (last dimension varies fastest). `value` is either an array or, for sparse cubes, an object keyed by
// flat position. We flatten it into rows: { <dimension id>: <category code>, ..., value }.
// Formats below were checked live on 2026-10-14 against the Eurostat dissemination API (datasets nrg_pc_204, nrg_pc_202).
// Eurostat API reference: https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/api-statistics

import { SourceError } from "../http";
import { asList, buildQuery, FetchOptions, isObject, resolveFetcher } from "./common";

/** One observation. Keys are dimension ids (values are category codes) plus `value`; `status` (a flag such as "p" = provisional) only when the dataset has one. */
export interface JsonStatRow {
  [dimension: string]: string | number | null;
  value: number | null;
}

export interface JsonStatTable {
  /** Dataset title, e.g. "Electricity prices for household consumers - bi-annual data". */
  label: string | null;
  source: string | null;
  /** When the publisher last updated the dataset (as given). */
  updated: string | null;
  /** Dimension ids in cube order, e.g. ["freq","siec","nrg_cons","unit","tax","currency","geo","time"]. */
  ids: string[];
  /** Number of categories per dimension, same order as ids. */
  sizes: number[];
  /** Category codes per dimension in index order. */
  codes: Record<string, string[]>;
  /** Readable labels: labels[dimension][code] (falls back to the code). */
  labels: Record<string, Record<string, string>>;
  /** Readable name of each dimension, e.g. { geo: "Geopolitical entity (reporting)" }. */
  dimensionLabels: Record<string, string>;
  /** Observations that have a value; missing cells (null) are left out. */
  rows: JsonStatRow[];
}

function errorLabel(json: Record<string, any>): string {
  const e = json.error;
  if (Array.isArray(e)) return e.map((x) => (isObject(x) ? String(x.label ?? x.id ?? x.status ?? "") : String(x))).filter(Boolean).join("; ");
  if (isObject(e)) return String(e.label ?? e.message ?? "");
  return typeof e === "string" ? e : "";
}

/** Category codes in index order. `index` may be an array of codes, an object {code: position}, or missing for a one-category dimension. */
function categoryCodes(category: Record<string, any>): string[] {
  const idx = category.index;
  if (Array.isArray(idx)) return idx.map(String);
  if (isObject(idx)) {
    const codes: string[] = [];
    for (const [code, pos] of Object.entries(idx)) codes[Number(pos)] = code;
    return codes.map((c) => c ?? "");
  }
  return isObject(category.label) ? Object.keys(category.label) : [];
}

/** Parse a JSON-stat 2.0 dataset (dense or sparse values, optional status) into flat rows plus label lookups. */
export function parseJsonStat(json: unknown): JsonStatTable {
  if (isObject(json) && json.error) {
    throw new SourceError(`The statistics service refused the request: ${errorLabel(json) || "unknown error"}`.slice(0, 300));
  }
  if (!isObject(json) || (json.class !== undefined && json.class !== "dataset") || !Array.isArray(json.id) || !Array.isArray(json.size) || !isObject(json.dimension)) {
    throw new SourceError("Unexpected response from the statistics service (not a JSON-stat dataset)");
  }
  const ids: string[] = json.id.map(String);
  const sizes: number[] = json.size.map(Number);
  if (ids.length !== sizes.length || sizes.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new SourceError("Unexpected response from the statistics service (id and size do not match)");
  }

  const codes: Record<string, string[]> = {};
  const labels: Record<string, Record<string, string>> = {};
  const dimensionLabels: Record<string, string> = {};
  ids.forEach((id, i) => {
    const dim = isObject(json.dimension[id]) ? json.dimension[id] : {};
    const category = isObject(dim.category) ? dim.category : {};
    const list = categoryCodes(category);
    if (list.length !== sizes[i]) throw new SourceError(`Unexpected response from the statistics service (dimension ${id} has ${list.length} categories, size says ${sizes[i]})`);
    codes[id] = list;
    const lab = isObject(category.label) ? category.label : {};
    labels[id] = Object.fromEntries(list.map((c) => [c, typeof lab[c] === "string" ? lab[c] : c]));
    dimensionLabels[id] = typeof dim.label === "string" ? dim.label : id;
  });

  // strides[i] = number of flat positions per step in dimension i (the last dimension varies fastest)
  const strides: number[] = new Array(ids.length);
  let total = 1;
  for (let i = ids.length - 1; i >= 0; i--) {
    strides[i] = total;
    total *= sizes[i];
  }

  const status = json.status;
  const statusAt = (pos: number): string | null => {
    if (typeof status === "string") return status;
    if (Array.isArray(status)) return status[pos] ?? null;
    if (isObject(status)) return typeof status[String(pos)] === "string" ? status[String(pos)] : null;
    return null;
  };
  const hasStatus = status !== undefined && status !== null;

  // Positions are visited in ascending order (array order, or the ascending integer keys of a sparse object),
  // which is cube order: first dimension slowest, last fastest.
  const rows: JsonStatRow[] = [];
  const emit = (pos: number, value: unknown) => {
    if (value === null || value === undefined) return;
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const cell: Record<string, string | number | null> = {};
    let rest = pos;
    ids.forEach((id, i) => {
      const at = Math.floor(rest / strides[i]);
      rest -= at * strides[i];
      cell[id] = codes[id][at];
    });
    const out: JsonStatRow = { ...cell, value: v };
    const flag = hasStatus ? statusAt(pos) : null;
    if (flag !== null) out.status = flag;
    rows.push(out);
  };

  const values = json.value;
  if (Array.isArray(values)) {
    values.forEach((v, pos) => {
      if (pos < total) emit(pos, v);
    });
  } else if (isObject(values)) {
    for (const [key, v] of Object.entries(values)) {
      const pos = Number(key);
      if (Number.isInteger(pos) && pos >= 0 && pos < total) emit(pos, v);
    }
  } else if (values !== undefined && values !== null) {
    throw new SourceError("Unexpected response from the statistics service (value is neither a list nor an object)");
  }

  return {
    label: typeof json.label === "string" ? json.label : null,
    source: typeof json.source === "string" ? json.source : null,
    updated: typeof json.updated === "string" ? json.updated : null,
    ids,
    sizes,
    codes,
    labels,
    dimensionLabels,
    rows,
  };
}

/** Rows matching every given dimension code, e.g. rowsWhere(table, { geo: "IE", tax: "I_TAX" }). */
export function rowsWhere(table: JsonStatTable, match: Record<string, string | string[]>): JsonStatRow[] {
  const want = Object.entries(match).map(([dim, v]) => [dim, new Set(asList(v))] as const);
  return table.rows.filter((r) => want.every(([dim, set]) => set.has(String(r[dim]))));
}

// ---------- Eurostat ----------

export const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

export interface EurostatOptions {
  /** Keep periods from this one on, e.g. "2025-S1" or "2024". Can combine with untilTimePeriod. */
  sinceTimePeriod?: string;
  untilTimePeriod?: string;
  /** Keep the last N periods of the dataset. Cannot combine with since/until or a time filter. */
  lastTimePeriod?: number;
  lang?: "EN" | "FR" | "DE";
  /** Override the API root (tests). */
  baseUrl?: string;
}

const RESERVED = new Set(["format", "lang", "sincetimeperiod", "untiltimeperiod", "lasttimeperiod"]);

/**
 * https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<code>?format=JSON&lang=EN&<dimension>=<code>...
 * An array value repeats the key (geo=FR&geo=DE). Dimension filters are case-insensitive on Eurostat's side.
 * Throws on a malformed dataset code or filter name, and on time options that Eurostat does not allow together.
 */
export function eurostatUrl(code: string, filters: Record<string, string | string[]> = {}, opts: EurostatOptions = {}): string {
  if (!/^[a-z0-9_]{3,40}$/i.test(code)) throw new Error(`Invalid Eurostat dataset code ${code}`);
  const pairs: Array<[string, string | number]> = [
    ["format", "JSON"],
    ["lang", opts.lang ?? "EN"],
  ];
  let timeFilter = false;
  for (const [dim, v] of Object.entries(filters)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(dim)) throw new Error(`Invalid Eurostat dimension name ${dim}`);
    if (RESERVED.has(dim.toLowerCase())) throw new Error(`${dim} is an option, not a dimension filter`);
    if (dim.toLowerCase() === "time" || dim.toLowerCase() === "time_period") timeFilter = true;
    const list = asList(v);
    if (!list.length) throw new Error(`Filter ${dim} has no value`);
    for (const x of list) pairs.push([dim, x]);
  }
  const since = opts.sinceTimePeriod, until = opts.untilTimePeriod, last = opts.lastTimePeriod;
  const timeOptions = [timeFilter, last !== undefined, since !== undefined || until !== undefined].filter(Boolean).length;
  if (timeOptions > 1) throw new Error("Eurostat allows only one time parameter per query (sinceTimePeriod and untilTimePeriod may be combined)");
  if (since !== undefined) pairs.push(["sinceTimePeriod", since]);
  if (until !== undefined) pairs.push(["untilTimePeriod", until]);
  if (last !== undefined) {
    if (!Number.isInteger(last) || last < 1) throw new RangeError(`lastTimePeriod must be a whole number of 1 or more, got ${last}`);
    pairs.push(["lastTimePeriod", last]);
  }
  return `${opts.baseUrl ?? EUROSTAT_BASE}/${code.toLowerCase()}?${buildQuery(pairs)}`;
}

/** ISO 3166 alpha-2 -> Eurostat geo code. Eurostat writes Greece as EL and the United Kingdom as UK. */
export function toEurostatGeo(iso: string): string {
  const c = iso.trim().toUpperCase();
  return c === "GR" ? "EL" : c === "GB" ? "UK" : c;
}

/** Eurostat geo code -> ISO 3166 alpha-2 (EL -> GR, UK -> GB). */
export function fromEurostatGeo(code: string): string {
  const c = code.trim().toUpperCase();
  return c === "EL" ? "GR" : c === "UK" ? "GB" : c;
}

/** Fetch a Eurostat dataset slice and parse it. */
export async function fetchEurostat(code: string, filters: Record<string, string | string[]> = {}, opts: EurostatOptions = {}, o: FetchOptions = {}): Promise<JsonStatTable> {
  return parseJsonStat(await resolveFetcher(o)(eurostatUrl(code, filters, opts)));
}

/** Fetch any JSON-stat URL (a PxWeb or national statistics API) and parse it. */
export async function fetchJsonStat(url: string, o: FetchOptions = {}): Promise<JsonStatTable> {
  return parseJsonStat(await resolveFetcher(o)(url));
}

// ---------- time periods ----------

/** First and last day of a Eurostat time period: "2026" (year), "2026-S1" (half), "2026-Q3" (quarter), "2026-03" (month). Null if unrecognised. */
export function periodRange(code: string): { from: string; to: string } | null {
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d2 = (n: number) => String(n).padStart(2, "0");
  let m = /^(\d{4})$/.exec(code);
  if (m) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  m = /^(\d{4})-S([12])$/.exec(code);
  if (m) return m[2] === "1" ? { from: `${m[1]}-01-01`, to: `${m[1]}-06-30` } : { from: `${m[1]}-07-01`, to: `${m[1]}-12-31` };
  m = /^(\d{4})-Q([1-4])$/.exec(code);
  if (m) {
    const q = Number(m[2]);
    const y = Number(m[1]);
    const endMonth = q * 3;
    return { from: `${m[1]}-${d2(endMonth - 2)}-01`, to: `${m[1]}-${d2(endMonth)}-${d2(lastDay(y, endMonth))}` };
  }
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(code);
  if (m) return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${d2(lastDay(Number(m[1]), Number(m[2])))}` };
  return null;
}

/** The period just before: "2026-S1" -> "2025-S2", "2026-Q1" -> "2025-Q4", "2026-01" -> "2025-12", "2026" -> "2025". Null if unrecognised. */
export function previousPeriod(code: string): string | null {
  let m = /^(\d{4})$/.exec(code);
  if (m) return String(Number(m[1]) - 1);
  m = /^(\d{4})-S([12])$/.exec(code);
  if (m) return m[2] === "2" ? `${m[1]}-S1` : `${Number(m[1]) - 1}-S2`;
  m = /^(\d{4})-Q([1-4])$/.exec(code);
  if (m) return m[2] !== "1" ? `${m[1]}-Q${Number(m[2]) - 1}` : `${Number(m[1]) - 1}-Q4`;
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(code);
  if (m) return m[2] !== "01" ? `${m[1]}-${String(Number(m[2]) - 1).padStart(2, "0")}` : `${Number(m[1]) - 1}-12`;
  return null;
}
