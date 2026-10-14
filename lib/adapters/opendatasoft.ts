// OpenDataSoft adapter (Explore API v2.1). OpenDataSoft is the open-data software behind data.economie.gouv.fr,
// data.iledefrance.fr, opendata.paris.fr, public.opendatasoft.com and many other French, Belgian and corporate portals.
// Records:  https://<domain>/api/explore/v2.1/catalog/datasets/<dataset>/records?select=..&where=..&limit=100
// Exports:  https://<domain>/api/explore/v2.1/catalog/datasets/<dataset>/exports/json  (the whole dataset unless limited)
// Formats below were checked live on 2026-10-14 against data.economie.gouv.fr.
//
// Limits of the records endpoint: at most 100 rows per request, and offset + limit may not pass 10 000.
// Past that, use exports (with a limit) or, for a whole file, a harvest().

import { SourceError } from "../http";
import { asList, buildQuery, clampMaxRows, Collected, collectPages, csv, FetchOptions, isObject, PagingOptions, resolveFetcher, wholeNumber } from "./common";

export const ODS_MAX_LIMIT = 100;
export const ODS_MAX_WINDOW = 10000;

export interface OdsQuery {
  /** Fields or expressions: ["ville", "avg(gazole_prix) as prix"]. */
  select?: string | string[];
  /** ODSQL condition: "gazole_prix > 0 and dep_name = 'Gironde'". */
  where?: string;
  groupBy?: string | string[];
  /** "n desc" or ["a asc", "b desc"]. */
  orderBy?: string | string[];
  /** Facet filters: { ville: "Bordeaux" } becomes refine=ville:Bordeaux (repeat for several values). */
  refine?: Record<string, string | string[]>;
  /** Facet exclusions, same shape as refine. */
  exclude?: Record<string, string | string[]>;
  limit?: number;
  offset?: number;
  lang?: string;
  timezone?: string;
}

export type OdsExportFormat = "json" | "jsonl" | "csv" | "geojson";

function cleanDomain(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(d) || !d.includes(".")) throw new Error(`Invalid OpenDataSoft domain ${domain}`);
  return d;
}

function datasetBase(domain: string, datasetId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(datasetId)) throw new Error(`Invalid OpenDataSoft dataset id ${datasetId}`);
  return `https://${cleanDomain(domain)}/api/explore/v2.1/catalog/datasets/${datasetId}`;
}

function facetPairs(key: "refine" | "exclude", m?: Record<string, string | string[]>): Array<[string, string]> {
  return Object.entries(m ?? {}).flatMap(([field, v]) => asList(v).map((x): [string, string] => [key, `${field}:${x}`]));
}

function sharedPairs(q: OdsQuery): Array<[string, string | number | undefined]> {
  return [
    ["select", csv(q.select)],
    ["where", q.where],
    ["group_by", csv(q.groupBy)],
    ["order_by", csv(q.orderBy)],
    ...facetPairs("refine", q.refine),
    ...facetPairs("exclude", q.exclude),
    ["lang", q.lang],
    ["timezone", q.timezone],
  ];
}

/** .../records?select=..&where=..&limit=..&offset=.. ; limit is capped at 100 and offset + limit at 10 000 (throws otherwise). */
export function odsRecordsUrl(domain: string, datasetId: string, q: OdsQuery = {}): string {
  const limit = wholeNumber("limit", q.limit, { min: 0, max: ODS_MAX_LIMIT });
  const offset = wholeNumber("offset", q.offset);
  if ((offset ?? 0) + (limit ?? 0) > ODS_MAX_WINDOW) {
    throw new RangeError(`The Explore API cannot return rows past ${ODS_MAX_WINDOW} (offset ${offset} + limit ${limit}); use exports with a limit`);
  }
  const query = buildQuery([...sharedPairs(q), ["limit", limit], ["offset", offset]]);
  return `${datasetBase(domain, datasetId)}/records${query ? `?${query}` : ""}`;
}

/**
 * .../exports/json (or jsonl, csv, geojson). With no limit this is the WHOLE dataset: always pass `limit` from live code.
 * Use limit -1 only inside a harvest() that really wants every row.
 */
export function odsExportUrl(domain: string, datasetId: string, q: OdsQuery & { format?: OdsExportFormat } = {}): string {
  const format = q.format ?? "json";
  if (!["json", "jsonl", "csv", "geojson"].includes(format)) throw new Error(`Unsupported export format ${format}`);
  if (q.limit !== undefined && q.limit !== -1) wholeNumber("limit", q.limit, { min: 1 });
  const query = buildQuery([...sharedPairs(q), ["limit", q.limit], ["offset", wholeNumber("offset", q.offset)]]);
  return `${datasetBase(domain, datasetId)}/exports/${format}${query ? `?${query}` : ""}`;
}

/** Parse a records answer: {total_count, results:[...]}. Errors are {error_code, message}. */
export function parseOdsRecords(json: unknown): { total: number; results: Record<string, any>[] } {
  if (isObject(json) && typeof json.error_code === "string") {
    throw new SourceError(`The open-data portal (OpenDataSoft) refused the request: ${String(json.message ?? json.error_code)}`.slice(0, 300), json.error_code);
  }
  if (!isObject(json) || !Array.isArray(json.results)) throw new SourceError("Unexpected response from the open-data portal (not an OpenDataSoft record list)");
  const total = Number(json.total_count);
  return { total: Number.isFinite(total) ? total : json.results.length, results: json.results.filter(isObject) };
}

/** Parse an exports/json answer: a plain JSON array of row objects. */
export function parseOdsExport(json: unknown): Record<string, any>[] {
  if (isObject(json) && typeof json.error_code === "string") parseOdsRecords(json); // throws with the portal's message
  if (!Array.isArray(json)) throw new SourceError("Unexpected response from the open-data portal (not an OpenDataSoft export)");
  return json.filter(isObject);
}

export async function odsQuery(domain: string, datasetId: string, q: OdsQuery = {}, o: FetchOptions = {}) {
  return parseOdsRecords(await resolveFetcher(o)(odsRecordsUrl(domain, datasetId, q)));
}

/** Download at most `limit` rows (default 5 000) through exports/json, in one request. */
export async function odsExport(domain: string, datasetId: string, q: OdsQuery & { limit?: number } = {}, o: PagingOptions = {}): Promise<Collected<Record<string, any>>> {
  const maxRows = Math.min(q.limit ?? Infinity, clampMaxRows(o.maxRows));
  const rows = parseOdsExport(await resolveFetcher(o)(odsExportUrl(domain, datasetId, { ...q, limit: maxRows })));
  return { rows: rows.slice(0, maxRows), total: null, truncated: rows.length >= maxRows, pages: 1 };
}

/** Page through records (100 a request) until maxRows (default 5 000, never past the 10 000 window). */
export async function odsAll(domain: string, datasetId: string, q: OdsQuery = {}, o: PagingOptions = {}): Promise<Collected<Record<string, any>>> {
  const start = q.offset ?? 0;
  const cap = Math.min(q.limit ?? Infinity, clampMaxRows(o.maxRows), ODS_MAX_WINDOW - start);
  if (cap < 1) return { rows: [], total: null, truncated: false, pages: 0 };
  return collectPages<Record<string, any>>({
    maxRows: cap,
    pageSize: Math.max(1, Math.min(o.pageSize ?? ODS_MAX_LIMIT, ODS_MAX_LIMIT)),
    fetchPage: async (offset, limit) => {
      const r = await odsQuery(domain, datasetId, { ...q, limit, offset: start + offset }, o);
      return { rows: r.results, total: Math.max(0, r.total - start) };
    },
  });
}
