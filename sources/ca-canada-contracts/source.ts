// Canadian federal contract values from the Treasury Board "Proactive Publication - Contracts over $10,000" (open.canada.ca), OGL-Canada 2.0.
// Licence read 2026-11-05 (Verifier, Notion row): "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive
// licence to use the Information, including for commercial purposes" https://open.canada.ca/en/open-government-licence-canada
// Format checked 2026-11-05 (first and last bytes read with curl -L -r from the workspace; GitHub probe 41943221912):
//   GET https://open.canada.ca/data/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b/resource/fac950c0-00d5-4ec1-a4d3-9cbebf98a305/download/contracts.csv
//   -> 302 to a signed blob URL (expires in about an hour, so it is followed every time), 655 MB, UTF-8 with BOM, comma separated, quoted text.
//   Columns used: reference_number, contract_date (yyyy-mm-dd), description_en (the economic-object description), contract_value
//   (original + amendments, CAD), commodity_type (S services, G goods, C construction). Vendor and buyer names are NEVER read or kept.
// The file is far too big to read per request: harvest() streams it once a day into the price library and answers come from there.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { normaliseText } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ca-canada-contracts",
  country: "CA (federal departments and agencies)",
  category: "government contracts (contract values)",
  name: "Proactive disclosure of federal contracts over CA$10,000 (Treasury Board of Canada Secretariat)",
  publisher: "Treasury Board of Canada Secretariat, via open.canada.ca",
  what_is_recorded:
    "Contracts above CA$10,000 that federal departments and agencies publish under the proactive disclosure policy: the contract date, the kind of purchase (the government's own economic-object description) and the contract value in Canadian dollars, including amendments.",
  price_type: "contract_price",
  freshness: "Quarterly: departments report each fiscal quarter and the publisher refreshes the file every three months, read by us daily",
  licence: "Open Government Licence - Canada (v2.0)",
  licence_url: "https://open.canada.ca/en/open-government-licence-canada",
  attribution:
    "Contains information licensed under the Open Government Licence - Canada. Source: Treasury Board of Canada Secretariat, Proactive Publication - Contracts over $10,000. Figures are ProofPrice aggregates (grouped, deduplicated, medians and ranges calculated).",
  homepage: "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
  limits:
    "Only federal contracts above CA$10,000 are listed, so the low end of every range sits near that floor. The value is the contract value as amended (original value plus amendments), usually over the whole contract period: it is a contracted amount, not a unit price and not money already paid. " +
    "Purchases are grouped by the government's own description of the kind of spending (for example 'Translation services', 'Management consulting'), not by product; you cannot ask for a brand or an item. " +
    "Contracts dated in the newest 24 months of the file are used; departments report late, so the newest weeks are thin. Amounts under CA$1,000 and over CA$5 billion are left out. " +
    "Aggregates only: suppliers, buyers and officials are never read or kept.",
  method_version: "1",
};

export const CSV_URL = "https://open.canada.ca/data/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b/resource/fac950c0-00d5-4ec1-a4d3-9cbebf98a305/download/contracts.csv";
export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 1000;
export const MAX_VALUE = 5_000_000_000;
export const UNIT = "per contract, total contract value (as amended)";
export const ITEM_PREFIX = "d:";
export const TYPE_PREFIX = "type:";
export const ALL_ITEM = "all";
export const MAX_ITEMS = 400;
const COLS = { ref: "reference_number", date: "contract_date", desc: "description_en", value: "contract_value", type: "commodity_type" } as const;

/** True when buyer_area asks for the federal proactive-disclosure file (serves() in index.ts). The CanadaBuys source answers every other CA request. */
export function isFederalArea(area: unknown): boolean {
  const t = normaliseText(String(area ?? ""));
  return ["federal", "federal government", "federal departments", "federal contracts", "government of canada", "canada", "proactive disclosure", "proactive publication", "treasury board"].includes(t);
}

/** Streaming CSV reader: feed text pieces in order; calls onRow with the fields of each finished record. Quotes, doubled quotes and line breaks inside quotes are handled. */
export class CsvReader {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false;
  private skipLF = false;
  constructor(private onRow: (row: string[]) => void) {}

  push(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.skipLF) {
        this.skipLF = false;
        if (c === "\n") continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (c === '"') this.pendingQuote = true;
        else this.field += c;
        continue;
      }
      if (c === '"' && this.field === "") this.inQuotes = true;
      else if (c === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r") this.skipLF = true;
        this.endRow();
      } else this.field += c;
    }
  }

  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== "" || this.row.length) this.endRow();
  }

  private endRow(): void {
    this.row.push(this.field);
    this.field = "";
    const r = this.row;
    this.row = [];
    if (r.length === 1 && r[0] === "") return;
    this.onRow(r);
  }
}

export interface CaContract {
  ref: string;
  date: string;
  value: number;
  /** Normalised kind of purchase (the item key without its prefix). */
  kind: string;
  /** goods, services or construction, or "". */
  type: string;
}

export type Cols = Record<keyof typeof COLS, number>;

/** Column positions by header name (a BOM on the first header is ignored); throws when the file no longer has the columns we rely on. */
export function headerIndex(header: string[]): Cols {
  const idx = {} as Cols;
  for (const k of Object.keys(COLS) as (keyof typeof COLS)[]) {
    const at = header.findIndex((h) => h.replace(/^﻿/, "").trim() === COLS[k]);
    if (at < 0) throw new SourceError(`Canada proactive-disclosure contracts file changed: column ${COLS[k]} not found`);
    idx[k] = at;
  }
  return idx;
}

/** The kind of purchase as a library key: normalised, at most 100 characters. */
export function kindOf(description: string): string {
  return normaliseText(description).slice(0, 100).trim();
}

const TYPES: Record<string, string> = { S: "services", G: "goods", C: "construction" };

/** Pure: one data row to a contract, or null (no date, no usable value, no description). Only five cells are read; supplier and buyer cells are never touched. */
export function contractFromRow(row: string[], idx: Cols): CaContract | null {
  const value = Number((row[idx.value] ?? "").trim());
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = (row[idx.date] ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const kind = kindOf(row[idx.desc] ?? "");
  if (!kind) return null;
  return { ref: (row[idx.ref] ?? "").trim(), date, value, kind, type: TYPES[(row[idx.type] ?? "").trim().toUpperCase()] ?? "" };
}

/** Pure: "2026-09-29" minus n months (day kept, clamped to the month's length). */
export function monthsBefore(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), last));
  return t.toISOString().slice(0, 10);
}

/** Pure: contracts to library rows (area ALL): every kind of purchase with 5+ contracts (the largest MAX_ITEMS), each contract type, and everything together. */
export function aggregate(contracts: Iterable<CaContract>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  const add = (k: string, v: number) => {
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.ref) {
      if (seen.has(c.ref)) continue; // one row per reference number
      seen.add(c.ref);
    }
    add(ALL_ITEM, c.value);
    if (c.type) add(TYPE_PREFIX + c.type, c.value);
    add(ITEM_PREFIX + c.kind, c.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  const kinds = rows.filter((r) => r.item.startsWith(ITEM_PREFIX)).sort((a, b) => b.n - a.n || a.item.localeCompare(b.item)).slice(0, MAX_ITEMS);
  const rest = rows.filter((r) => !r.item.startsWith(ITEM_PREFIX));
  return [...rest, ...kinds].sort((a, b) => a.item.localeCompare(b.item));
}

export interface StreamStats { rows: number }

/** Stream the file through the CSV reader and hand each usable contract to `sink`. */
export async function streamContracts(body: ReadableStream<Uint8Array>, sink: (c: CaContract) => void): Promise<StreamStats> {
  let idx: Cols | null = null;
  let rows = 0;
  const reader = new CsvReader((row) => {
    if (!idx) {
      idx = headerIndex(row);
      return;
    }
    rows++;
    const c = contractFromRow(row, idx);
    if (c) sink(c);
  });
  const decoder = new TextDecoder("utf-8");
  const r = body.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    reader.push(decoder.decode(value, { stream: true }));
  }
  reader.push(decoder.decode());
  reader.end();
  if (!idx) throw new SourceError("The Canadian proactive-disclosure contracts file was empty");
  return { rows };
}

export type OpenBody = () => Promise<ReadableStream<Uint8Array>>;
const openCsv: OpenBody = async () => {
  let res: Response;
  try {
    res = await fetch(CSV_URL, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(8 * 60 * 1000) });
  } catch (err: any) {
    throw new SourceError("Could not reach open.canada.ca", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok || !res.body) throw new SourceError(`open.canada.ca returned HTTP ${res.status}`, CSV_URL, res.status);
  return res.body;
};

export async function caContractsHarvest(now: Date = new Date(), open: OpenBody = openCsv): Promise<HarvestResult> {
  const body = await open();
  const contracts: CaContract[] = [];
  const { rows: read } = await streamContracts(body, (c) => contracts.push(c));
  if (read === 0) throw new SourceError("The Canadian proactive-disclosure contracts file held no rows");
  // the window ends at the newest contract date in the file (the file is quarterly and departments report late), never in the future
  let newest = "";
  for (const c of contracts) if (c.date > newest && c.date <= now.toISOString().slice(0, 10)) newest = c.date;
  if (!newest) throw new SourceError("No usable contract dates in the Canadian proactive-disclosure contracts file: the layout may have changed");
  const from = monthsBefore(newest, WINDOW_MONTHS);
  const rows = aggregate(contracts, from, newest);
  if (!rows.some((r) => r.item === ALL_ITEM)) throw new SourceError("No contract group with 5 or more contracts in the window: the file may have changed");
  return {
    date: newest,
    currency: "CAD",
    unit: UNIT,
    rows,
    note: `Contracts dated ${from} to ${newest}; ${contracts.length} usable contracts read from ${read} rows; ${rows.length} groups with 5+ contracts.`,
  };
}

// ---------- the answer ----------

export interface CaInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

const words = (s: string) => normaliseText(s).split(" ").filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Pure: the library item that a request's words point to, among the rows' items. "all"/"goods"/"services"/"construction" first, then an exact kind, then the largest kind that holds every word. */
export function matchItem(what: string, rows: { item: string; n: number }[]): { item: string; related: string[] } | null {
  const t = normaliseText(what);
  if (["all", "everything", "all contracts", "any"].includes(t)) return { item: ALL_ITEM, related: [] };
  if (["goods", "services", "construction"].includes(t) && rows.some((r) => r.item === TYPE_PREFIX + t)) return { item: TYPE_PREFIX + t, related: [] };
  const kinds = rows.filter((r) => r.item.startsWith(ITEM_PREFIX));
  const exact = kinds.find((r) => r.item === ITEM_PREFIX + t);
  if (exact) return { item: exact.item, related: [] };
  const w = words(what);
  if (!w.length) return null;
  const hits = kinds
    .filter((r) => {
      const kw = words(r.item.slice(ITEM_PREFIX.length));
      return w.every((x) => kw.some((y) => y === x || (x.length >= 5 && y.startsWith(x))));
    })
    .sort((a, b) => b.n - a.n);
  if (!hits.length) return null;
  return { item: hits[0].item, related: hits.slice(1, 4).map((h) => h.item.slice(ITEM_PREFIX.length)) };
}

export async function caFederalContracts(input: CaInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Canada (federal): cpv is not used. Say what was bought in words, for example 'translation services' or 'management consulting'.");
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Canadian federal contract values have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const m = matchItem(input.what, day.rows);
  if (!m) {
    const top = day.rows.filter((r) => r.item.startsWith(ITEM_PREFIX)).sort((a, b) => b.n - a.n).slice(0, 6).map((r) => `'${r.item.slice(ITEM_PREFIX.length)}'`);
    throw new InputError(
      `Canada (federal): "${input.what}" is not one of the kinds of purchase in the federal contract disclosure, which groups spending by the government's own descriptions. Try what=all, goods, services or construction, or a kind such as ${top.join(", ")}.`,
    );
  }
  const row = day.rows.find((r) => r.area === "ALL" && r.item === m.item);
  const from = monthsBefore(day.date, WINDOW_MONTHS);
  const label = m.item === ALL_ITEM ? "federal contracts of all kinds" : m.item.startsWith(TYPE_PREFIX) ? `federal ${m.item.slice(TYPE_PREFIX.length)} contracts` : `federal contracts for '${m.item.slice(ITEM_PREFIX.length)}'`;
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CA", what: input.what, buyer_area: input.buyer_area ?? "federal" },
    summary,
    currency: "CAD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Federal contracts over CA$10,000 dated ${from} to ${day.date} in the Treasury Board proactive disclosure (${label}). Median and 10th–90th percentile of the contract value in CAD, original value plus amendments. ` +
      "A contracted amount (usually over the whole contract period), not a unit price and not money already paid; suppliers and buyers are never named.",
    describe: (s) =>
      `Canadian federal departments signed ${label} with a median total value of ${fmtMoney(s.median, "CAD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "CAD")} to ${fmtMoney(s.high, "CAD")}, 10th to 90th percentile). These are contract values as amended, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "contract value as amended (original plus amendments), not a unit price", matched_group: m.item, ...(m.related.length ? { related_groups: m.related } : {}), newest_contract: day.date, newest_collection: day.date },
  });
}
