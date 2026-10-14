// CKAN adapter. CKAN is the open-data software behind data.gov.uk, data.gov.au, open.canada.ca, catalog.data.gov,
// data.qld.gov.au and hundreds more; data.gov.sg offers the same action API at /api/action.
// The action API lives at <site>/api/3/action/<action>. Responses look like {success, result} or {success:false, error}.
// Formats below were checked live on 2026-10-14 against www.data.qld.gov.au (and data.gov.sg for datastore_search).

import { SourceError } from "../http";
import {
  buildQuery, clampMaxRows, Collected, collectPages, csv, FetchOptions, isObject, PagingOptions, resolveFetcher, wholeNumber,
} from "./common";

type Scalar = string | number | boolean | null;

/** Parameters of datastore_search. */
export interface CkanSearch {
  resourceId: string;
  /** Exact-match filters, e.g. { Fuel_Type: "Diesel" } or { state: ["NSW", "VIC"] }. Sent as JSON. */
  filters?: Record<string, Scalar | Scalar[]>;
  /** Full-text query: a string, or per-column text { Site_Name: "Liberty" } (sent as JSON). */
  q?: string | Record<string, string>;
  fields?: string[];
  /** e.g. "_id desc" or ["Price asc", "_id desc"]. Sort when paging, or pages may repeat rows. */
  sort?: string | string[];
  limit?: number;
  offset?: number;
  /** false skips the (sometimes slow) total count. */
  includeTotal?: boolean;
}

/** "https://www.data.qld.gov.au", ".../api/3" or ".../api/3/action" all give ".../api/3/action". A ".../api/action" base (data.gov.sg) is kept as given. */
export function ckanApiBase(site: string): string {
  let s = site.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(s)) throw new Error(`CKAN site must be an https URL, got ${site}`);
  if (/\/api\/3\/action$/i.test(s) || /\/api\/action$/i.test(s)) return s;
  if (/\/api\/3$/i.test(s)) return `${s}/action`;
  s = s.replace(/\/api$/i, "");
  return `${s}/api/3/action`;
}

export function ckanActionUrl(site: string, action: string, query: string): string {
  if (!/^[a-z_]+$/.test(action)) throw new Error(`Invalid CKAN action ${action}`);
  return `${ckanApiBase(site)}/${action}${query ? `?${query}` : ""}`;
}

export function datastoreSearchUrl(site: string, s: CkanSearch): string {
  if (!s.resourceId.trim()) throw new Error("resourceId is required");
  return ckanActionUrl(
    site,
    "datastore_search",
    buildQuery([
      ["resource_id", s.resourceId.trim()],
      ["filters", s.filters && Object.keys(s.filters).length ? JSON.stringify(s.filters) : undefined],
      ["q", s.q === undefined ? undefined : typeof s.q === "string" ? s.q : JSON.stringify(s.q)],
      ["fields", csv(s.fields)],
      ["sort", csv(s.sort)],
      ["limit", wholeNumber("limit", s.limit, { min: 0 })],
      ["offset", wholeNumber("offset", s.offset)],
      ["include_total", s.includeTotal === undefined ? undefined : s.includeTotal],
    ]),
  );
}

/** datastore_search_sql: a read-only SELECT, e.g. an aggregate. Quote identifiers with sqlIdent, text with sqlLiteral. */
export function datastoreSearchSqlUrl(site: string, sql: string): string {
  if (!/^\s*select\b/i.test(sql)) throw new Error("datastore_search_sql only takes a SELECT statement");
  return ckanActionUrl(site, "datastore_search_sql", buildQuery([["sql", sql.trim()]]));
}

export function packageShowUrl(site: string, idOrName: string): string {
  return ckanActionUrl(site, "package_show", buildQuery([["id", idOrName.trim()]]));
}

/** "Fuel_Type" -> "\"Fuel_Type\"" (CKAN's SQL is PostgreSQL; resource ids are table names and must be quoted too). */
export function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 'O\'Brien' -> "'O''Brien'". Numbers pass through. */
export function sqlLiteral(v: string | number): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("SQL number must be finite");
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

// ---------- parsers (pure) ----------

function ckanResult(json: unknown): Record<string, any> {
  if (!isObject(json)) throw new SourceError("Unexpected response from the open-data portal (not CKAN JSON)");
  if (json.success !== true || !isObject(json.result)) {
    const err = isObject(json.error) ? json.error : {};
    const msg = typeof err.message === "string" ? err.message : typeof json.error === "string" ? json.error : "no result";
    throw new SourceError(`The open-data portal (CKAN) refused the request: ${msg}`.slice(0, 300), typeof err.__type === "string" ? err.__type : undefined);
  }
  return json.result;
}

export interface CkanField {
  id: string;
  type: string;
}

export interface CkanSearchResult {
  records: Record<string, any>[];
  /** Rows matching the filters (null when the portal does not count). */
  total: number | null;
  fields: CkanField[];
  /** Relative URL of the next page, when the portal gives one. */
  next: string | null;
}

function parseFields(v: unknown): CkanField[] {
  return Array.isArray(v) ? v.filter(isObject).map((f) => ({ id: String(f.id), type: String(f.type ?? "") })) : [];
}

/** Parse a datastore_search answer ({success, result:{records, fields, total, _links}}). */
export function parseDatastoreSearch(json: unknown): CkanSearchResult {
  const r = ckanResult(json);
  if (!Array.isArray(r.records)) throw new SourceError("Unexpected response from the open-data portal (no records)");
  const total = typeof r.total === "number" ? r.total : r.total !== undefined && Number.isFinite(Number(r.total)) ? Number(r.total) : null;
  return {
    records: r.records.filter(isObject),
    total,
    fields: parseFields(r.fields),
    next: isObject(r._links) && typeof r._links.next === "string" ? r._links.next : null,
  };
}

/** Parse a datastore_search_sql answer ({success, result:{records, fields, sql}}). */
export function parseDatastoreSql(json: unknown): { records: Record<string, any>[]; fields: CkanField[] } {
  const r = ckanResult(json);
  if (!Array.isArray(r.records)) throw new SourceError("Unexpected response from the open-data portal (no records)");
  return { records: r.records.filter(isObject), fields: parseFields(r.fields) };
}

export interface CkanResource {
  id: string;
  name: string;
  /** Upper-case, e.g. "CSV", "JSON". */
  format: string;
  url: string;
  datastoreActive: boolean;
  /** ISO timestamp the file last changed (last_modified, else created). */
  modified: string | null;
  mimetype: string | null;
}

export interface CkanPackage {
  id: string;
  name: string;
  title: string;
  licenceId: string | null;
  licenceTitle: string | null;
  licenceUrl: string | null;
  metadataModified: string | null;
  resources: CkanResource[];
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Parse a package_show answer into the dataset's licence and its list of files (resources). */
export function parsePackageShow(json: unknown): CkanPackage {
  const r = ckanResult(json);
  if (!Array.isArray(r.resources)) throw new SourceError("Unexpected response from the open-data portal (no resources)");
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    title: String(r.title ?? r.name ?? ""),
    licenceId: text(r.license_id),
    licenceTitle: text(r.license_title),
    licenceUrl: text(r.license_url),
    metadataModified: text(r.metadata_modified),
    resources: r.resources.filter(isObject).map((x) => ({
      id: String(x.id ?? ""),
      name: String(x.name ?? ""),
      format: String(x.format ?? "").trim().toUpperCase(),
      url: String(x.url ?? ""),
      datastoreActive: x.datastore_active === true,
      modified: text(x.last_modified) ?? text(x.created),
      mimetype: text(x.mimetype),
    })),
  };
}

/**
 * The most recently modified file of a dataset that matches, e.g. the newest CSV.
 * Ties go to the one listed last (portals list files oldest first).
 */
export function latestResource(
  resources: CkanResource[],
  want: { format?: string | string[]; datastoreOnly?: boolean; nameMatches?: RegExp } = {},
): CkanResource | null {
  const formats = (Array.isArray(want.format) ? want.format : want.format ? [want.format] : []).map((f) => f.toUpperCase());
  let best: CkanResource | null = null;
  for (const r of resources) {
    if (!r.url) continue;
    if (formats.length && !formats.includes(r.format)) continue;
    if (want.datastoreOnly && !r.datastoreActive) continue;
    if (want.nameMatches && !want.nameMatches.test(r.name)) continue;
    if (!best || (r.modified ?? "") >= (best.modified ?? "")) best = r;
  }
  return best;
}

// ---------- fetch wrappers ----------

export async function ckanSearch(site: string, s: CkanSearch, o: FetchOptions = {}): Promise<CkanSearchResult> {
  return parseDatastoreSearch(await resolveFetcher(o)(datastoreSearchUrl(site, s)));
}

export async function ckanSql(site: string, sql: string, o: FetchOptions = {}) {
  return parseDatastoreSql(await resolveFetcher(o)(datastoreSearchSqlUrl(site, sql)));
}

export async function ckanPackage(site: string, idOrName: string, o: FetchOptions = {}): Promise<CkanPackage> {
  return parsePackageShow(await resolveFetcher(o)(packageShowUrl(site, idOrName)));
}

/** The newest file of the given format in a dataset, or null. Use its `url` for a one-off look; bulk files belong in harvest(). */
export async function ckanLatestResource(
  site: string,
  idOrName: string,
  want: Parameters<typeof latestResource>[1] = {},
  o: FetchOptions = {},
): Promise<CkanResource | null> {
  return latestResource((await ckanPackage(site, idOrName, o)).resources, want);
}

/** Page through datastore_search until maxRows (default 5 000). Pass `sort` so pages do not repeat rows. */
export async function ckanAll(site: string, s: CkanSearch, o: PagingOptions = {}): Promise<Collected<Record<string, any>>> {
  const maxRows = clampMaxRows(o.maxRows);
  const cap = Math.min(s.limit ?? Infinity, maxRows); // a caller's limit is a ceiling for the whole collection
  return collectPages<Record<string, any>>({
    maxRows: cap,
    pageSize: Math.max(1, Math.min(o.pageSize ?? 1000, 32000)),
    fetchPage: async (offset, limit) => {
      const r = await ckanSearch(site, { ...s, limit, offset: (s.offset ?? 0) + offset }, o);
      return { rows: r.records, total: r.total === null ? null : Math.max(0, r.total - (s.offset ?? 0)) };
    },
  });
}
