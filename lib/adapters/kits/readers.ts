// Statistics kit, part 1: READERS. One reader per way statistics offices publish a table. Each reader turns a request for a
// few cells (items, areas, the newest N periods) into ONE http request and the reply into the same flat rows:
//   { <dimension or column name>: "<code>", ..., value: <number> }
// plus the publisher's labels where the format carries them (so the kit can check that "1 l" is still "1 l").
//
//   jsonstat        any JSON-stat 2.0 URL, whole dataset (CSO PxStat, small PxWeb tables)       GET
//   pxweb-v2        PxWebApi 2 (Statistics Norway data.ssb.no/api/pxwebapi/v2)                 GET  valueCodes[dim]=...
//   pxweb-v1        PxWeb API v1 (Latvia, Finland, Slovenia, Sweden, Estonia, Iceland ...)     POST {query, response: json-stat2}
//   eurostat        Eurostat dissemination API (JSON-stat)                                       GET  via lib/adapters/jsonstat
//   sdmx-csv        SDMX 2.1 REST "data" with a CSV format (OECD, ABS, ECB, Eurostat SDMX ...)    GET  <base>/data/<flow>/<key>
//   odata           OData v3/v4 JSON {value:[...]} (CBS StatLine and similar)                    GET
//   ckan-datastore  a statistics table held in a CKAN datastore                                  GET  datastore_search
//
// Pure URL/body builders and parsers are tested in tests/kits.test.ts against real replies that live sources captured from the
// publishers. Network calls go through lib/http (hard timeout, honest user agent) or an injected fetcher in tests.
// Owner: the Adapter Steward (only builder allowed to change lib/adapters/kits/**). Change => bump KIT_VERSION in stats-table.ts.

import { SourceError, fetchJson } from "../../http";
import { buildQuery, isObject } from "../common";
import { parseJsonStat, eurostatUrl } from "../jsonstat";
import { datastoreSearchUrl, parseDatastoreSearch } from "../ckan";

export type ReaderConfig =
  | { kind: "jsonstat"; url: string }
  | { kind: "pxweb-v2"; url: string; lang?: string }
  | { kind: "pxweb-v1"; url: string }
  | { kind: "eurostat"; dataset: string }
  | {
      kind: "sdmx-csv";
      /** REST root, e.g. "https://sdmx.oecd.org/public/rest". */
      base: string;
      /** Dataflow reference as the service writes it, e.g. "OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1". */
      flow: string;
      /** Dimension ids in key order (the time dimension is not part of the key). */
      keyOrder: string[];
      /** The service's CSV format value, e.g. "csvfilewithlabels" (OECD) or "SDMX-CSV" (Eurostat). Default "csvfilewithlabels". */
      format?: string;
    }
  | { kind: "odata"; url: string; /** Raw $filter, e.g. "Perioden gt '20261005'". */ filter?: string }
  | { kind: "ckan-datastore"; site: string; resourceId: string; /** Newest rows first, e.g. "Period desc". */ sort?: string };

/** The kinds whose replies are cubes (dimensions with code lists); the others are rows of named columns. */
export const CUBE_KINDS = new Set(["jsonstat", "pxweb-v2", "pxweb-v1", "eurostat"]);

/** Which cells to ask for. Dimension names are the publisher's ids (cube) or column names (rows). */
export interface Selection {
  /** dimension -> codes to keep (item, area and fixed dimensions). */
  dims: Record<string, string[]>;
  /** The time dimension's id / column. */
  time: string;
  /** Ask for the newest N periods where the format allows it. */
  lastN: number;
}

export interface KitRow {
  [dimension: string]: string | number | null;
  value: number | null;
}

export interface KitTable {
  rows: KitRow[];
  /** labels[dimension][code], when the format carries labels (JSON-stat, SDMX CSV with labels). */
  labels: Record<string, Record<string, string>>;
  title: string | null;
  updated: string | null;
}

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  /** JSON body for POST. */
  body?: unknown;
  /** What the reply is parsed as. */
  as: "json" | "text";
}

const enc = (s: string) => encodeURIComponent(s).replace(/%2C/g, ",");

/** The single request a reader sends for a selection. Pure. */
export function buildRequest(r: ReaderConfig, sel: Selection): HttpRequest {
  switch (r.kind) {
    case "jsonstat":
      return { url: r.url, method: "GET", as: "json" };
    case "pxweb-v2": {
      // PxWebApi 2: every mandatory variable must be selected; brackets are sent encoded (%5B %5D), as the probe lesson says.
      const parts = [`lang=${r.lang ?? "en"}`, "outputFormat=json-stat2"];
      for (const [dim, codes] of Object.entries(sel.dims)) if (codes.length) parts.push(`valueCodes%5B${enc(dim)}%5D=${codes.map(enc).join(",")}`);
      parts.push(`valueCodes%5B${enc(sel.time)}%5D=top(${sel.lastN})`);
      return { url: `${r.url}${r.url.includes("?") ? "&" : "?"}${parts.join("&")}`, method: "GET", as: "json" };
    }
    case "pxweb-v1": {
      const query: unknown[] = Object.entries(sel.dims)
        .filter(([, codes]) => codes.length)
        .map(([code, values]) => ({ code, selection: { filter: "item", values } }));
      query.push({ code: sel.time, selection: { filter: "top", values: [String(sel.lastN)] } });
      return { url: r.url, method: "POST", body: { query, response: { format: "json-stat2" } }, as: "json" };
    }
    case "eurostat":
      return { url: eurostatUrl(r.dataset, sel.dims, { lastTimePeriod: sel.lastN }), method: "GET", as: "json" };
    case "sdmx-csv": {
      const key = r.keyOrder.map((d) => (sel.dims[d] ?? []).join("+")).join(".");
      const q = buildQuery([["lastNObservations", sel.lastN], ["format", r.format ?? "csvfilewithlabels"]]);
      return { url: `${r.base.replace(/\/+$/, "")}/data/${r.flow}/${key}?${q}`, method: "GET", as: "text" };
    }
    case "odata": {
      const q = r.filter ? `$filter=${encodeURIComponent(r.filter)}` : "";
      return { url: q ? `${r.url}${r.url.includes("?") ? "&" : "?"}${q}` : r.url, method: "GET", as: "json" };
    }
    case "ckan-datastore": {
      const filters: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(sel.dims)) if (v.length) filters[k] = v;
      return {
        url: datastoreSearchUrl(r.site, { resourceId: r.resourceId, filters, sort: r.sort, limit: 1000, includeTotal: false }),
        method: "GET",
        as: "json",
      };
    }
  }
}

// ---------- parsers (pure) ----------

/** RFC 4180 CSV -> rows of cells (quoted fields, doubled quotes, CRLF). */
export function parseCsvText(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) out.push(row);
  return out;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * SDMX-CSV. Plain SDMX-CSV has one column per dimension id plus OBS_VALUE; OECD's "csvfilewithlabels" puts each label in the
 * column right after its code (header "REF_AREA,Reference area,..."). Labels are read when present.
 */
export function parseSdmxCsv(text: string): KitTable {
  const cells = parseCsvText(text);
  if (cells.length < 1) throw new SourceError("Unexpected response from the statistics service (empty SDMX-CSV)");
  const header = cells[0];
  const valueAt = header.indexOf("OBS_VALUE");
  if (valueAt < 0) throw new SourceError("Unexpected response from the statistics service (SDMX-CSV has no OBS_VALUE column)");
  const isId = (h: string) => /^[A-Z][A-Z0-9_]*$/.test(h);
  // a label column follows its id column and is not itself an id
  const labelOf = new Map<number, number>();
  header.forEach((h, i) => {
    if (isId(h) && i + 1 < header.length && !isId(header[i + 1])) labelOf.set(i, i + 1);
  });
  const labels: Record<string, Record<string, string>> = {};
  const rows: KitRow[] = [];
  for (const line of cells.slice(1)) {
    const row: KitRow = { value: toNumber(line[valueAt]) };
    header.forEach((h, i) => {
      if (!isId(h) || i === valueAt) return;
      row[h] = line[i] ?? "";
      const li = labelOf.get(i);
      if (li !== undefined && line[li]) (labels[h] ??= {})[line[i]] = line[li];
    });
    if (row.value !== null) rows.push(row);
  }
  return { rows, labels, title: null, updated: null };
}

/** OData v3/v4 JSON: {value:[{col: v, ...}]} (also v2 {d:{results:[...]}}). Every column becomes a string except the numbers kept in `value` later. */
export function parseODataRows(json: unknown): Record<string, unknown>[] {
  if (isObject(json) && Array.isArray(json.value)) return json.value as Record<string, unknown>[];
  if (isObject(json) && isObject(json.d) && Array.isArray(json.d.results)) return json.d.results as Record<string, unknown>[];
  if (isObject(json) && json["odata.error"]) throw new SourceError("The statistics service refused the request (OData error)");
  throw new SourceError("Unexpected response from the statistics service (not an OData value list)");
}

/**
 * Row tables (OData, CKAN, SDMX-CSV) to kit rows. Long layout: one value column, item in a column. Wide layout (CBS fuel: one
 * column per product): each listed item column becomes its own row with dimension `itemDim` = the column name.
 */
export function rowsFromRecords(
  records: Record<string, unknown>[],
  layout: { valueColumn: string } | { wideItemColumns: string[]; itemDim: string },
): KitRow[] {
  const out: KitRow[] = [];
  for (const rec of records) {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined && typeof v !== "object") base[k] = String(v).trim();
    if ("valueColumn" in layout) {
      const value = toNumber(rec[layout.valueColumn]);
      if (value !== null) out.push({ ...base, value });
    } else {
      for (const col of layout.wideItemColumns) {
        const value = toNumber(rec[col]);
        if (value !== null) out.push({ ...base, [layout.itemDim]: col, value });
      }
    }
  }
  return out;
}

/** Parse a reply. Cube readers return JSON-stat; row readers return records that the caller lays out with rowsFromRecords. */
export function parseReply(r: ReaderConfig, body: unknown): { cube: KitTable } | { records: Record<string, unknown>[]; labels?: KitTable["labels"] } {
  switch (r.kind) {
    case "jsonstat":
    case "pxweb-v2":
    case "pxweb-v1":
    case "eurostat": {
      const t = parseJsonStat(body);
      return { cube: { rows: t.rows as KitRow[], labels: t.labels, title: t.label, updated: t.updated } };
    }
    case "sdmx-csv": {
      if (typeof body !== "string") throw new SourceError("Unexpected response from the statistics service (SDMX-CSV expected)");
      const t = parseSdmxCsv(body);
      return { cube: t };
    }
    case "odata":
      return { records: parseODataRows(body) };
    case "ckan-datastore":
      return { records: parseDatastoreSearch(body).records };
  }
}

// ---------- network ----------

export type KitFetcher = (req: HttpRequest) => Promise<unknown>;

const UA = "pricepaid-plug/0.1 (+price-paid data for AI agents)";

/** Default fetcher: one request through lib/http (JSON) or a plain text GET with the same timeout and user agent. */
export function defaultFetcher(timeoutMs = 20000): KitFetcher {
  return async (req) => {
    if (req.as === "json") {
      const init: RequestInit = req.method === "POST" ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) } : {};
      return fetchJson(req.url, init, timeoutMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(req.url, { signal: controller.signal, headers: { "user-agent": UA, accept: "text/csv, application/vnd.sdmx.data+csv, */*" } });
      if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
      return await res.text();
    } catch (err: any) {
      if (err?.name === "AbortError") throw new SourceError("Source timed out", req.url);
      if (err instanceof SourceError) throw err;
      throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
    } finally {
      clearTimeout(timer);
    }
  };
}

