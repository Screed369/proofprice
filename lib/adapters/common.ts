// Shared plumbing for the universal portal adapters (ckan, socrata, opendatasoft, arcgis, jsonstat).
// Everything here is dependency-free. Each adapter has PURE functions (URL builders and parsers, unit-tested against
// fixtures copied from the real responses) and thin fetch wrappers that call lib/http.ts fetchJson (hard timeout).
// Tests inject a fake `fetcher`, so paging logic is tested without a network.
//
// Rule for builders: an adapter is for LIVE QUERIES that return a few rows or an aggregate. Bulk files (whole datasets,
// daily dumps) never go through a request: they go through the source's harvest() and the price library.

import { fetchJson } from "../http";

/** Fetches a URL and returns the parsed JSON body. Throws SourceError on HTTP errors, timeouts and network failures. */
export type Fetcher = (url: string) => Promise<unknown>;

export interface FetchOptions {
  /** Replace the network call (tests). Default: lib/http fetchJson. */
  fetcher?: Fetcher;
  /** Hard timeout per request in milliseconds. Default 20 000. */
  timeoutMs?: number;
}

export interface PagingOptions extends FetchOptions {
  /** Most rows ever returned, however large the dataset is. Default 5 000, hard ceiling 50 000. */
  maxRows?: number;
  /** Rows asked for per request. Each adapter has its own default and cap. */
  pageSize?: number;
}

export const DEFAULT_MAX_ROWS = 5000;
export const HARD_MAX_ROWS = 50000;
export const DEFAULT_TIMEOUT_MS = 20000;
/** Safety net against a server that ignores offsets and keeps returning the same page. */
export const MAX_PAGES = 200;

export function resolveFetcher(o: FetchOptions = {}): Fetcher {
  return o.fetcher ?? ((url) => fetchJson(url, {}, o.timeoutMs ?? DEFAULT_TIMEOUT_MS));
}

/** The row cap actually applied: a whole number between 1 and HARD_MAX_ROWS. */
export function clampMaxRows(n?: number): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_MAX_ROWS;
  return Math.max(1, Math.min(HARD_MAX_ROWS, Math.floor(n)));
}

export function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "a" -> ["a"], ["a","b"] -> ["a","b"], undefined/empty -> []. */
export function asList(v: string | string[] | undefined | null): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter((x) => x !== "");
}

/** Comma-joined list, or undefined when empty. */
export function csv(v: string | string[] | undefined | null): string | undefined {
  const l = asList(v);
  return l.length ? l.join(",") : undefined;
}

type QueryValue = string | number | boolean | null | undefined;

/**
 * Build a query string from ordered [key, value] pairs. Undefined, null and empty-string values are left out; every
 * value is percent-encoded (spaces become %20). A `$` in a key (SoQL's $select) is kept readable.
 */
export function buildQuery(pairs: Array<[string, QueryValue]>): string {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k).replace(/%24/g, "$")}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** Whole non-negative integer, or undefined. Throws on anything else so a typo never silently downloads too much. */
export function wholeNumber(name: string, v: number | undefined, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be a whole number from ${min} to ${max}, got ${v}`);
  return v;
}

/** One page of a paged answer. `more` is the server's own word that rows remain; when absent we infer it from `total`. */
export interface PageResult<T> {
  rows: T[];
  total?: number | null;
  more?: boolean;
}

export interface Collected<T> {
  rows: T[];
  /** Total rows the source says match (null when it does not say). */
  total: number | null;
  /** True when we stopped at maxRows (or the page limit) while the source still had more. */
  truncated: boolean;
  pages: number;
}

/**
 * Collect pages until the source has no more or maxRows is reached. Never asks for more than maxRows in total.
 * `fetchPage(offset, limit)` is called with the number of rows already held as the offset.
 */
export async function collectPages<T>(opts: {
  maxRows?: number;
  pageSize: number;
  maxPages?: number;
  fetchPage: (offset: number, limit: number) => Promise<PageResult<T>>;
}): Promise<Collected<T>> {
  const maxRows = clampMaxRows(opts.maxRows);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const rows: T[] = [];
  let total: number | null = null;
  let pages = 0;
  let more = false;
  while (rows.length < maxRows && pages < maxPages) {
    const limit = Math.max(1, Math.min(opts.pageSize, maxRows - rows.length));
    const page = await opts.fetchPage(rows.length, limit);
    pages++;
    if (page.total !== undefined && page.total !== null) total = page.total;
    rows.push(...page.rows.slice(0, limit));
    more = page.more ?? (page.rows.length >= limit && (total === null || rows.length < total));
    if (page.rows.length === 0 || !more) {
      more = false;
      break;
    }
  }
  return { rows, total, truncated: more, pages };
}
