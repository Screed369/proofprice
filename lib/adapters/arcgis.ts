// ArcGIS REST adapter (FeatureServer / MapServer layers). ArcGIS is the GIS software behind most city, state and
// national "open data hub" portals (hub.arcgis.com sites, services.arcgis.com/<org>/... hosted layers, and agency
// servers such as tigerweb.geo.census.gov). A layer URL ends in /FeatureServer/<n> or /MapServer/<n>; we call <layer>/query.
// Formats below were checked live on 2026-10-14 against tigerweb.geo.census.gov (US Census Bureau).
//
// Paging: a server returns at most its own maxRecordCount rows and sets "exceededTransferLimit": true when more match.
// Always pass orderByFields when paging so pages do not overlap.

import { SourceError } from "../http";
import { buildQuery, clampMaxRows, Collected, collectPages, csv, FetchOptions, isObject, PagingOptions, resolveFetcher, wholeNumber } from "./common";

export interface ArcgisStatistic {
  statisticType: "count" | "sum" | "min" | "max" | "avg" | "stddev" | "var";
  onStatisticField: string;
  outStatisticFieldName: string;
}

export interface ArcgisQuery {
  /** SQL-92 condition. Default "1=1" (everything). */
  where?: string;
  /** Default "*". */
  outFields?: string | string[];
  /** "NAME ASC" or ["STATE ASC", "COUNTY ASC"]. */
  orderByFields?: string | string[];
  resultOffset?: number;
  resultRecordCount?: number;
  /** Default false: we want attributes, not shapes. */
  returnGeometry?: boolean;
  groupByFieldsForStatistics?: string | string[];
  outStatistics?: ArcgisStatistic[];
}

/** https://.../FeatureServer/0  ->  .../FeatureServer/0/query?where=..&outFields=..&f=json */
export function arcgisQueryUrl(layerUrl: string, q: ArcgisQuery = {}, extra: Array<[string, string | number | boolean]> = []): string {
  const base = layerUrl.trim().replace(/\/+$/, "").replace(/\/query$/i, "");
  if (!/^https:\/\/.+\/(FeatureServer|MapServer)\/\d+$/i.test(base)) {
    throw new Error(`ArcGIS layer URL must end in /FeatureServer/<n> or /MapServer/<n>, got ${layerUrl}`);
  }
  const query = buildQuery([
    ["where", q.where?.trim() || "1=1"],
    ["outFields", q.outStatistics ? undefined : csv(q.outFields) ?? "*"],
    ["orderByFields", csv(q.orderByFields)],
    ["groupByFieldsForStatistics", csv(q.groupByFieldsForStatistics)],
    ["outStatistics", q.outStatistics?.length ? JSON.stringify(q.outStatistics) : undefined],
    ["returnGeometry", q.returnGeometry ?? false],
    ["resultOffset", wholeNumber("resultOffset", q.resultOffset)],
    ["resultRecordCount", wholeNumber("resultRecordCount", q.resultRecordCount, { min: 1 })],
    ...extra,
    ["f", "json"],
  ]);
  return `${base}/query?${query}`;
}

/** .../query?where=..&returnCountOnly=true : how many features match, without downloading them. */
export function arcgisCountUrl(layerUrl: string, where = "1=1"): string {
  return arcgisQueryUrl(layerUrl, { where }, [["returnCountOnly", true]]);
}

export interface ArcgisField {
  name: string;
  type: string;
  alias: string | null;
}

export interface ArcgisResult {
  /** feature.attributes for each feature (geometry is dropped). */
  rows: Record<string, any>[];
  fields: ArcgisField[];
  /** True when the server stopped at its own limit and more features match. */
  exceededTransferLimit: boolean;
}

function throwIfArcgisError(json: unknown): void {
  if (isObject(json) && isObject(json.error)) {
    const msg = typeof json.error.message === "string" ? json.error.message : "request refused";
    const details = Array.isArray(json.error.details) ? json.error.details.map(String).join("; ") : "";
    throw new SourceError(`The map server (ArcGIS) refused the request: ${msg}${details ? ` (${details})` : ""}`.slice(0, 300), String(json.error.code ?? ""));
  }
}

/** Parse a layer query answer: {fields, features:[{attributes}], exceededTransferLimit}. Errors are {error:{code, message}}. */
export function parseArcgisQuery(json: unknown): ArcgisResult {
  throwIfArcgisError(json);
  if (!isObject(json) || !Array.isArray(json.features)) throw new SourceError("Unexpected response from the map server (not an ArcGIS query result)");
  return {
    rows: json.features.filter(isObject).map((f) => (isObject(f.attributes) ? f.attributes : {})),
    fields: Array.isArray(json.fields)
      ? json.fields.filter(isObject).map((f) => ({ name: String(f.name), type: String(f.type ?? ""), alias: typeof f.alias === "string" ? f.alias : null }))
      : [],
    exceededTransferLimit: json.exceededTransferLimit === true,
  };
}

/** Parse a returnCountOnly answer: {count: 3143}. */
export function parseArcgisCount(json: unknown): number {
  throwIfArcgisError(json);
  if (!isObject(json) || !Number.isFinite(Number(json.count))) throw new SourceError("Unexpected response from the map server (no count)");
  return Number(json.count);
}

export async function arcgisQuery(layerUrl: string, q: ArcgisQuery = {}, o: FetchOptions = {}): Promise<ArcgisResult> {
  return parseArcgisQuery(await resolveFetcher(o)(arcgisQueryUrl(layerUrl, q)));
}

export async function arcgisCount(layerUrl: string, where = "1=1", o: FetchOptions = {}): Promise<number> {
  return parseArcgisCount(await resolveFetcher(o)(arcgisCountUrl(layerUrl, where)));
}

/** Page while the server says exceededTransferLimit, until maxRows (default 5 000). */
export async function arcgisAll(layerUrl: string, q: ArcgisQuery = {}, o: PagingOptions = {}): Promise<Collected<Record<string, any>>> {
  const start = q.resultOffset ?? 0;
  const cap = Math.min(q.resultRecordCount ?? Infinity, clampMaxRows(o.maxRows));
  return collectPages<Record<string, any>>({
    maxRows: cap,
    pageSize: Math.max(1, Math.min(o.pageSize ?? 1000, 10000)),
    fetchPage: async (offset, limit) => {
      const r = await arcgisQuery(layerUrl, { ...q, resultOffset: start + offset, resultRecordCount: limit }, o);
      return { rows: r.rows, more: r.exceededTransferLimit };
    },
  });
}
