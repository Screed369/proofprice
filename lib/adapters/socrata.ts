// Socrata (SODA 2.x) adapter. Socrata is the open-data software behind data.cityofchicago.org, data.cityofnewyork.us,
// data.sfgov.org, data.seattle.gov, data.cdc.gov and many more US city, state and agency portals.
// A dataset is addressed by a "4x4" id (e.g. 4ijn-s7e5) and queried with SoQL: https://<domain>/resource/<id>.json?$select=...
// Formats below were checked live on 2026-10-14 against data.cityofchicago.org.
// Note: aggregates come back with every value as a string ({"n":"164093"}); convert with Number().

import { SourceError } from "../http";
import { buildQuery, clampMaxRows, Collected, collectPages, csv, FetchOptions, isObject, PagingOptions, resolveFetcher, wholeNumber } from "./common";

export interface SodaQuery {
  /** Columns or expressions: ["results", "count(*) as n"]. */
  select?: string | string[];
  /** SoQL condition: "inspection_date > '2026-01-01T00:00:00' AND results = 'Fail'". */
  where?: string;
  group?: string | string[];
  having?: string;
  /** "n DESC" or ["a ASC", "b DESC"]. Always give an order when paging, or pages may overlap. */
  order?: string | string[];
  /** Full-text search over all text columns ($q). */
  q?: string;
  limit?: number;
  offset?: number;
}

const DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const FOUR_BY_FOUR = /^[a-z0-9]{4}-[a-z0-9]{4}$/i;

/** "data.cityofchicago.org" or "https://data.cityofchicago.org/" -> "data.cityofchicago.org". */
function cleanDomain(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!DOMAIN.test(d) || !d.includes(".")) throw new Error(`Invalid Socrata domain ${domain}`);
  return d;
}

/** https://<domain>/resource/<id>.json?$select=...&$where=... Every value is percent-encoded. */
export function socrataUrl(domain: string, datasetId: string, q: SodaQuery = {}): string {
  if (!FOUR_BY_FOUR.test(datasetId)) throw new Error(`Socrata dataset id must look like abcd-1234, got ${datasetId}`);
  const query = buildQuery([
    ["$select", csv(q.select)],
    ["$where", q.where],
    ["$group", csv(q.group)],
    ["$having", q.having],
    ["$order", csv(q.order)],
    ["$q", q.q],
    ["$limit", wholeNumber("limit", q.limit)],
    ["$offset", wholeNumber("offset", q.offset)],
  ]);
  return `https://${cleanDomain(domain)}/resource/${datasetId.toLowerCase()}.json${query ? `?${query}` : ""}`;
}

/** SoQL text literal: 'O''Brien'. */
export function soqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Parse a SODA answer: a plain JSON array of row objects. Socrata errors are {message, errorCode, data}. */
export function parseSoda(json: unknown): Record<string, any>[] {
  if (Array.isArray(json)) return json.filter(isObject);
  if (isObject(json) && (json.error || json.errorCode)) {
    const msg = typeof json.message === "string" ? json.message : "request refused";
    throw new SourceError(`The open-data portal (Socrata) refused the request: ${msg}`.slice(0, 300), typeof json.errorCode === "string" ? json.errorCode : undefined);
  }
  throw new SourceError("Unexpected response from the open-data portal (not a Socrata row list)");
}

export async function socrataQuery(domain: string, datasetId: string, q: SodaQuery = {}, o: FetchOptions = {}): Promise<Record<string, any>[]> {
  return parseSoda(await resolveFetcher(o)(socrataUrl(domain, datasetId, q)));
}

/** Page through a dataset with $limit/$offset until maxRows (default 5 000). Socrata does not report a total here. */
export async function socrataAll(domain: string, datasetId: string, q: SodaQuery = {}, o: PagingOptions = {}): Promise<Collected<Record<string, any>>> {
  const cap = Math.min(q.limit ?? Infinity, clampMaxRows(o.maxRows));
  return collectPages<Record<string, any>>({
    maxRows: cap,
    pageSize: Math.max(1, Math.min(o.pageSize ?? 1000, 50000)),
    fetchPage: async (offset, limit) => {
      const rows = await socrataQuery(domain, datasetId, { ...q, limit, offset: (q.offset ?? 0) + offset }, o);
      return { rows };
    },
  });
}
