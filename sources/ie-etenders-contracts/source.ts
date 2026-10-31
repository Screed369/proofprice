// Irish public contract prices from the Office of Government Procurement (OGP) eTenders open data file, CC BY 4.0.
// Licence read 2026-10-31 (Verifier) in the CKAN record https://data.gov.ie/api/3/action/package_show?id=contract-notices-published-on-etenders :
//   license_id "CC-BY-4.0" ("Creative Commons Attribution 4.0"), publisher OGP.
// Format checked 2026-10-31 with a full download (plain GET, no key, no cookies):
//   https://assets.gov.ie/static/documents/edf2df28/Public_Procurement_Opendata_Dataset.csv
//   -> 35,784,502 bytes, text/csv, Windows-1252 (cp1252, "Iarnród Éireann"), 89,734 rows, 31 columns. Dates are DD/MM/YYYY, numbers plain dot-decimal.
//   Columns used: "Tender ID", "Competition Type" (Bespoke, Standalone Direct Invite, FW - Mini-Comp, Simplified, Framework, DPS Tender, DPS/UQS),
//   "Main Cpv Code" (8 digits), "Award Published" (DD/MM/YYYY), "Sum of Awarded Value (€)" (filled on 32,089 rows).
//   Buyer, supplier and tender-name columns exist in the file and are never read or kept (suppliers can be sole traders).
// The file is a bulk download (tens of MB), so only harvest() in the daily collector reads it; answers come from the price library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ie-etenders-contracts",
  country: "IE (central government, local authorities, HSE, universities and other public buyers)",
  category: "government contracts (award results)",
  name: "eTenders: Irish public contract awards (OGP open data)",
  publisher: "Office of Government Procurement (OGP), eTenders open data on data.gov.ie",
  what_is_recorded:
    "Contract awards that Irish public buyers publish through eTenders: what was bought (CPV product code), the date the award was published and the awarded contract value in euro (ex VAT), for awards above EUR 25,000.",
  price_type: "contract_price",
  freshness: "Quarterly: the publisher refreshes the file every quarter and our copy is collected once a day",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Office of Government Procurement (OGP), eTenders open data, CC BY 4.0. Figures are ProofPrice aggregates of the published awards.",
  homepage: "https://data.gov.ie/dataset/contract-notices-published-on-etenders",
  limits:
    "Awards published through eTenders above EUR 25,000, in euro and ex VAT, as the buyer states them; they are total contract values, not unit prices and not amounts already paid. " +
    "Framework agreements and dynamic purchasing systems are left out (their value is a maximum ceiling, not spend), as are values under 1,000 euro (placeholders) and over 500 million euro (ceilings and entry errors); a tender counts once. " +
    "Purchases are recognised from the main CPV product code. The file is updated quarterly, so the newest awards can be a few months old (the answer gives the dates). " +
    "Aggregates only; buyers and suppliers are never read or kept.",
  method_version: "1",
};

export const CSV_URL = "https://assets.gov.ie/static/documents/edf2df28/Public_Procurement_Opendata_Dataset.csv";
/** Months of awards kept in each daily aggregate. */
export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 1000;
export const MAX_VALUE = 500_000_000;
export const UNIT = "per contract, total awarded value (ex VAT)";
export const WINDOW_PREFIX = "window:";
/** Competition types whose awarded value is a ceiling for many future call-offs, not what was agreed for one purchase. */
const CEILING_TYPES = /^(framework|dps)/i;

// ---------- CSV (streamed: the file is 36 MB) ----------

/** Incremental CSV reader for RFC 4180 text with quoted cells (line breaks and doubled quotes inside quotes). Feed text chunks, get rows. */
export class CsvReader {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false;
  private skippedBom = false;
  constructor(private onRow: (row: string[]) => void) {}

  push(text: string): void {
    let i = 0;
    if (!this.skippedBom && text.length) {
      if (text.charCodeAt(0) === 0xfeff) i = 1;
      this.skippedBom = true;
    }
    for (; i < text.length; i++) {
      const c = text[i];
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
      } else if (c === '"') {
        this.inQuotes = true;
      } else if (c === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        this.endRow();
      } else {
        this.field += c;
      }
    }
  }

  /** Call after the last chunk: a file without a final line break still yields its last row. */
  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field.length || this.row.length) this.endRow();
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

const COLS = {
  id: "Tender ID",
  competition: "Competition Type",
  cpv: "Main Cpv Code",
  awardDate: "Award Published",
  value: "Sum of Awarded Value (€)",
} as const;

/** One award, with only the fields we use. */
export interface IeAward {
  id: string;
  date: string; // YYYY-MM-DD
  value: number;
  cpv: string; // 8 digits
}

/** Column positions by header name; throws a SourceError when the file no longer has the columns we rely on. */
export function headerIndex(header: string[]): Record<keyof typeof COLS, number> {
  const clean = header.map((h) => h.replace(/^﻿/, "").trim());
  const out = {} as Record<keyof typeof COLS, number>;
  for (const k of Object.keys(COLS) as (keyof typeof COLS)[]) {
    const i = clean.indexOf(COLS[k]);
    if (i < 0) throw new SourceError(`The eTenders file no longer has the column "${COLS[k]}": the format may have changed`);
    out[k] = i;
  }
  return out;
}

/** Pure: "29/09/2026" to "2026-09-29", or "" when it is not a real date. */
export function ieDate(s: string): string {
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s ?? ""));
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? "" : iso;
}

/** Pure: one CSV row to an award, or null when it carries no usable contract price. */
export function awardFromRow(row: string[], idx: Record<keyof typeof COLS, number>): IeAward | null {
  if (CEILING_TYPES.test((row[idx.competition] ?? "").trim())) return null;
  const raw = (row[idx.value] ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  if (!(value >= MIN_VALUE && value <= MAX_VALUE)) return null;
  const date = ieDate(row[idx.awardDate] ?? "");
  if (!date) return null;
  const cpv = (row[idx.cpv] ?? "").trim();
  if (!/^\d{8}$/.test(cpv)) return null;
  const id = (row[idx.id] ?? "").trim();
  if (!id) return null;
  return { id, date, value, cpv };
}

/** Pure: "2026-09-29" minus n months. */
export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** The library items an award belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item with at least 5 distinct tenders in the window. A tender counts once. */
export function aggregateAll(awards: Iterable<IeAward>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const a of awards) {
    if (a.date < from || a.date > to || seen.has(a.id)) continue;
    seen.add(a.id);
    for (const item of itemsOf(a.cpv)) {
      const g = groups.get(item);
      if (g) g.push(a.value);
      else groups.set(item, [a.value]);
    }
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Marker row: the first day of the window, e.g. "window:2024-10-31". No price (NO_COUNT, zeros), so no answer can show it as a figure. */
export function windowMarker(oldest: string, newest: string): DailyRow {
  return { area: "ALL", item: `${WINDOW_PREFIX}${oldest}..${newest}`, n: NO_COUNT, median: 0, low: 0, high: 0, min: 0, max: 0 };
}
export function windowOf(rows: { area: string; item: string }[]): { from: string; to: string } | null {
  const m = rows.find((r) => r.area === "ALL" && r.item.startsWith(WINDOW_PREFIX));
  if (!m) return null;
  const [from, to] = m.item.slice(WINDOW_PREFIX.length).split("..");
  return from && to ? { from, to } : null;
}

/** Stream the CSV through the reader and hand each usable award to `sink`. Returns the number of data rows read. */
export async function streamAwards(url: string, sink: (a: IeAward) => void, timeoutMs = 300000): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    throw new SourceError("Could not reach the eTenders open data file (assets.gov.ie)", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok || !res.body) throw new SourceError(`The eTenders open data file returned HTTP ${res.status}`, url, res.status);
  let idx: Record<keyof typeof COLS, number> | null = null;
  let rows = 0;
  const reader = new CsvReader((row) => {
    if (!idx) {
      idx = headerIndex(row);
      return;
    }
    rows++;
    const a = awardFromRow(row, idx);
    if (a) sink(a);
  });
  const decoder = new TextDecoder("windows-1252"); // the file is cp1252, not UTF-8
  const body = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      reader.push(decoder.decode(value, { stream: true }));
    }
  } catch (err: any) {
    throw new SourceError("The eTenders open data file was cut off while downloading", String(err?.cause?.code ?? err?.message ?? err));
  }
  reader.push(decoder.decode());
  reader.end();
  if (!idx) throw new SourceError("The eTenders open data file was empty");
  return rows;
}

export interface HarvestOptions {
  stream?: (sink: (a: IeAward) => void) => Promise<number>; // for tests
}

export async function ieContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const today = now.toISOString().slice(0, 10);
  const from = windowStart(today);
  const awards: IeAward[] = [];
  const read = await (o.stream ?? ((sink) => streamAwards(CSV_URL, sink)))((a) => {
    if (a.date >= from && a.date <= today) awards.push(a);
  });
  if (read < 1000) throw new SourceError(`The eTenders open data file held only ${read} rows: it may be cut off or have changed`);
  if (!awards.length) throw new SourceError("The eTenders open data file held no usable awards in the window: the layout may have changed");
  const newest = awards.reduce((m, a) => (a.date > m ? a.date : m), awards[0].date);
  const rows = aggregateAll(awards, from, today);
  rows.push(windowMarker(from, newest));
  return {
    date: today,
    currency: "EUR",
    unit: UNIT,
    rows,
    note: `Awards published ${from} to ${newest}; ${awards.length} usable awards read from ${read} rows.`,
  };
}

// ---------- the answer ----------

export interface IeInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["catering", "school meals", "software", "consultancy", "legal services", "cars"];

export async function ieContracts(input: IeInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Ireland: buyer_area is not used; the figures are for all Irish public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Ireland: cpv must be a CPV product code of 2 digits (a division such as 45) or 4 to 8 digits (45233120); 4 digits or more are read as the 4-digit group (4523).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Ireland: "${input.what}" is not one of the purchases we summarise from the eTenders file. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Irish contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const win = windowOf(day.rows) ?? { from: windowStart(day.date), to: day.date };
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "IE", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "EUR",
    unit: UNIT,
    period: { from: win.from, to: win.to },
    method:
      `eTenders awards published ${win.from} to ${win.to}, recognised by their main CPV product code (${label}). Median and 10th–90th percentile of the awarded value in euro, ex VAT. ` +
      "Framework agreements and dynamic purchasing systems are left out (their value is a ceiling). Totals per contract, not unit prices; buyers and suppliers are never named.",
    describe: (s) =>
      `Irish public buyers awarded ${label} with a median total value of ${fmtMoney(s.median, "EUR")} per contract, ex VAT ` +
      `(typical range ${fmtMoney(s.low, "EUR")} to ${fmtMoney(s.high, "EUR")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value per contract (eTenders award), ex VAT, not a unit price", ...matched, newest_collection: day.date, newest_award: win.to },
  });
}
