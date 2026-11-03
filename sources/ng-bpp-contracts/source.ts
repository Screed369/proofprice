// Nigerian federal public contract award values: the Bureau of Public Procurement's Nigeria Open Contracting Portal (NOCOPO), OCDS data,
// as compiled and republished by the Open Contracting Partnership (OCP) data registry, publication 64.
// Licence read 2026-11-03 on the publisher's own page http://nocopo.bpp.gov.ng/license: "The Bureau of Public Procurement publishes the contract data
// using the ODC Public Domain Dedication and Licence (ODCPDDL)." (users may share, create and adapt; no attribution required, we credit anyway).
// Format proven 2026-11-03 from the cloud workspace: GET https://data.open-contracting.org/en/publication/64/download?name=full.csv.tar.gz
//   302 to https://fastly.data.open-contracting.org/downloads/nigeria_portal/4321/full.csv.tar.gz, 200, 22,650,746 bytes, a gzip-compressed tar holding
//   full/contracts.csv (5.3 MB, 17,055 rows), full/awards.csv, full/main.csv (50 MB) and others, file dates 2026-10-20 (the registry refreshes it monthly).
//   contracts.csv header: id,awardID,title,description,dateSigned,status,value_amount,value_currency,period_endDate,period_startDate,period_durationInDays,main_ocid,main_id
//   Row: 18622,18959,Construction of hybrid solar street lights in selected communities,<description>,2024-06-27T00:00:00Z,active,498738188,NGN,,,,ocds-gyl66f-215011001-000116,<main_id>
//   All 17,055 rows are NGN; status active 16,462, cancelled 357, pending 123, terminated 113. The publisher's own portal stops filling in new awards
//   around November 2024 (17,000 rows, almost none after that; a few stray dates in 2026 to 2028), so the answer states the newest month it can see.
// Outside check: the registry page states "Count of awards: 17,431" for the same publication; contracts.csv holds 17,055 contract rows (see the Notion row).
// Only contracts.csv is read. Supplier names (awards_suppliers.csv, parties.csv) are never read. The file is far too big to fetch per request:
// harvest() streams it once a day (it changes monthly) and keeps aggregates only.
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";

export const INFO: SourceInfo = {
  id: "ng-bpp-contracts",
  country: "NG (federal public bodies on NOCOPO)",
  category: "government contracts (awarded contracts)",
  name: "NOCOPO: Nigerian federal public procurement contract awards (Bureau of Public Procurement)",
  publisher: "Bureau of Public Procurement (BPP), Nigeria Open Contracting Portal (NOCOPO); OCDS data republished by the Open Contracting Partnership data registry",
  what_is_recorded:
    "Contracts that Nigerian federal public bodies awarded and signed: the signing date, the title of the purchase and the contract value in naira.",
  price_type: "contract_price",
  freshness: "Monthly refresh of the registry copy, but the portal itself has recorded almost no new awards since November 2024, so the newest figures are about two years old",
  licence: "ODC Public Domain Dedication and Licence (ODC-PDDL), Bureau of Public Procurement (licence text at http://nocopo.bpp.gov.ng/license)",
  licence_url: "https://data.open-contracting.org/en/publication/64",
  attribution:
    "Source: Nigeria Bureau of Public Procurement (NOCOPO), published under the ODC Public Domain Dedication and Licence, via the Open Contracting Partnership data registry. Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://data.open-contracting.org/en/publication/64",
  limits:
    "Contract values in naira over the whole contract (posted award values, not unit prices and not amounts paid yet); Nigerian inflation was high in 2023 and 2024, so older contracts look smaller. " +
    "Only contracts with status active, a value from 10,000 naira and a signing date that is not in the future are used, and a contract is counted once. " +
    "Purchase themes are matched by English keywords in the contract title, so a theme can include a few contracts that only mention the word, and a contract can count in more than one theme. " +
    "The portal stopped recording new awards in late 2024: the window ends at the newest month with at least 20 signed contracts. Federal bodies only, not states. " +
    "Aggregates only; suppliers in the open file are never read or kept.",
  method_version: "1",
};

export const DATA_URL = "https://data.open-contracting.org/en/publication/64/download?name=full.csv.tar.gz";
export const TAR_ENTRY = "contracts.csv";
export const WINDOW_MONTHS = 24;
export const MIN_MONTH_AWARDS = 20;
export const MIN_VALUE = 10000;
export const MAX_VALUE = 1e13;
export const CURRENCY = "NGN";
export const UNIT = "per contract, total contract value";

// ---------- purchase themes: English keywords in the contract title ----------

export interface Theme {
  id: string;
  label: string;
  re: RegExp;
  aliases: string[];
}

export const THEMES: Theme[] = [
  { id: "vehicles", label: "vehicles", re: /\b(vehicles?|buses|bus|cars?|trucks?|pick-?ups?|motorcycles?|ambulances?|jeeps?|toyota|hilux)\b/i, aliases: ["vehicle", "car", "cars", "bus", "trucks", "ambulance", "ambulances"] },
  { id: "fuel", label: "fuel and lubricants", re: /\b(ago|pms|diesel|petrol|fuel|lubricants?|kerosene|dpk|gasoline)\b/i, aliases: ["diesel", "petrol", "fuel", "lubricants"] },
  { id: "ict", label: "computers and ICT", re: /\b(computers?|laptops?|ict|software|servers?|network|printers?|photocopiers?|data cent(?:re|er)|internet|e-?governance)\b/i, aliases: ["computers", "laptops", "it", "it equipment", "software", "computer", "ict equipment"] },
  { id: "medical", label: "medical and hospital", re: /\b(medical|hospitals?|drugs?|pharmaceuticals?|surgical|clinic|clinics|health ?care|laborator(?:y|ies)|vaccines?|diagnostic)\b/i, aliases: ["medicine", "medicines", "health", "hospital", "drugs", "medical equipment"] },
  { id: "roads", label: "roads and bridges", re: /\b(roads?|bridges?|highways?|culverts?|interchange|drainage|asphalt|dualisation|dualization)\b/i, aliases: ["road", "road construction", "bridge", "roadworks"] },
  { id: "buildings", label: "building construction", re: /\b(construction|building|buildings|block|hostel|classrooms?|office complex|fencing|perimeter)\b/i, aliases: ["construction", "building", "buildings", "building works"] },
  { id: "rehabilitation", label: "rehabilitation and renovation", re: /\b(rehabilitation|renovation|refurbishment|repairs?|maintenance|remodel(?:l)?ing)\b/i, aliases: ["renovation", "repairs", "repair", "maintenance", "refurbishment"] },
  { id: "water", label: "water and boreholes", re: /\b(boreholes?|water|dams?|irrigation|sanitation|sewage|reservoirs?)\b/i, aliases: ["boreholes", "borehole", "water supply"] },
  { id: "power", label: "power, solar and generators", re: /\b(generators?|generating sets?|solar|electri(?:c|fication|city)|transformers?|street ?lights?|power|inverters?|substation)\b/i, aliases: ["electricity", "solar", "generators", "street lights", "generator"] },
  { id: "furniture", label: "furniture and fittings", re: /\b(furniture|furnishing|chairs?|desks?|tables?|beds?|mattress(?:es)?|cabinets?)\b/i, aliases: ["chairs", "desks", "furnishing", "office furniture"] },
  { id: "security", label: "security equipment", re: /\b(security|surveillance|cctv|alarm|scanners?|armoured|armored)\b/i, aliases: ["surveillance", "cctv"] },
  { id: "schools", label: "schools and education", re: /\b(schools?|education|educational|teaching|students?|universit(?:y|ies)|polytechnic|textbooks?|library)\b/i, aliases: ["school", "education", "university"] },
  { id: "agriculture", label: "farm inputs and agriculture", re: /\b(fertili[sz]ers?|seeds?|tractors?|agricultur(?:e|al)|farmers?|livestock|harvest(?:er|ers)?)\b/i, aliases: ["fertiliser", "fertilizer", "farm", "farming", "tractors", "agriculture"] },
  { id: "consultancy", label: "consultancy services", re: /\b(consultancy|consultant|consultants|consulting|supervision|feasibility|design and supervision)\b/i, aliases: ["consulting", "consultants", "consultant", "supervision"] },
];

export function themesOf(title: string): string[] {
  return THEMES.filter((t) => t.re.test(title)).map((t) => t.id);
}

export const ITEM_PREFIX = "t:";
export const NEWEST_PREFIX = "newest:";
/** Marker row item: the newest month that holds at least MIN_MONTH_AWARDS contracts, e.g. "newest:2024-11-28" (the newest signing date in that month).
 *  It carries no price (n NO_COUNT, zeros), so no answer can show it as a figure; the answer reads it to say how old the data really is. */
export function newestMarker(newest: string): DailyRow | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(newest) ? { area: "ALL", item: NEWEST_PREFIX + newest, n: NO_COUNT, median: 0, low: 0, high: 0, min: 0, max: 0 } : null;
}
export function newestOf(rows: { area: string; item: string }[]): string | null {
  const m = rows.find((r) => r.area === "ALL" && r.item.startsWith(NEWEST_PREFIX));
  return m ? m.item.slice(NEWEST_PREFIX.length) : null;
}

export function windowStart(end: string, months = WINDOW_MONTHS): string {
  const d = new Date(end + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate() + 1)).toISOString().slice(0, 10);
}

// ---------- reading the file: tar.gz stream, then CSV ----------

/** Streaming CSV reader: feed text pieces in order; calls onRow with the fields of each finished record. Handles quotes, doubled quotes and line breaks inside quotes. */
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

/** Reads a (decompressed) tar stream and passes the bytes of the first regular file whose base name is `want` to onData, in order. Everything else is skipped without being kept.
 *  Returns true when the entry was found. Understands plain ustar headers (512-byte blocks, octal size); a GNU long-name entry is skipped over. */
export async function tarEntry(stream: AsyncIterable<Uint8Array>, want: string, onData: (chunk: Uint8Array) => void): Promise<boolean> {
  let header = Buffer.alloc(0);
  let remaining = 0; // bytes of the current entry still to read
  let pad = 0; // padding bytes after the entry
  let mode: "header" | "want" | "skip" = "header";
  let found = false;
  for await (const piece of stream) {
    let buf: Buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    while (buf.length) {
      if (mode === "header") {
        const need = 512 - header.length;
        header = Buffer.concat([header, buf.subarray(0, need)]);
        buf = buf.subarray(need);
        if (header.length < 512) break;
        if (header.every((b) => b === 0)) {
          header = Buffer.alloc(0);
          continue; // end-of-archive block
        }
        const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
        const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
        const type = String.fromCharCode(header[156] || 48);
        header = Buffer.alloc(0);
        if (!Number.isFinite(size)) throw new SourceError("The Nigeria contracts archive has a header this reader does not understand");
        remaining = size;
        pad = (512 - (size % 512)) % 512;
        const base = name.split("/").pop();
        mode = (type === "0" || type === "\0") && base === want && !found ? "want" : "skip";
        if (remaining === 0) mode = "skip";
      }
      if (mode === "want" || mode === "skip") {
        if (remaining > 0) {
          const take = Math.min(remaining, buf.length);
          if (mode === "want") onData(buf.subarray(0, take));
          remaining -= take;
          buf = buf.subarray(take);
          if (remaining === 0 && mode === "want") found = true;
        }
        if (remaining === 0 && buf.length) {
          const p = Math.min(pad, buf.length);
          pad -= p;
          buf = buf.subarray(p);
          if (pad === 0) mode = "header";
        } else if (remaining === 0 && pad === 0) mode = "header";
      }
    }
    if (found && mode === "header") return true; // got what we need, stop downloading
  }
  return found;
}

export interface NgContract {
  id: string;
  date: string;
  value: number;
  themes: string[];
}

const REQUIRED = ["id", "title", "dateSigned", "status", "value_amount", "value_currency"];

export function columnsOf(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h.trim()] = i));
  const out: Record<string, number> = {};
  for (const name of REQUIRED) {
    if (idx[name] === undefined) throw new SourceError(`The Nigeria contracts file has no column "${name}": the format may have changed`);
    out[name] = idx[name];
  }
  return out;
}

/** "2024-06-27T00:00:00Z" to "2024-06-27", or "" when it is not a real date. */
export function isoDate(s: unknown): string {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return "";
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? "" : iso;
}

export interface Counts {
  rows: number;
  usable: number;
  status: Record<string, number>;
  other: number;
}
export function newCounts(): Counts {
  return { rows: 0, usable: 0, status: {}, other: 0 };
}

/** Pure: one CSV row to a contract, or null (not active, not naira, placeholder or entry error value, bad or future date). */
export function contractOf(row: string[], cols: Record<string, number>, today: string, counts?: Counts): NgContract | null {
  const status = String(row[cols.status] ?? "").trim().toLowerCase() || "(empty)";
  if (counts) {
    counts.rows++;
    if (counts.status[status] !== undefined || Object.keys(counts.status).length < 10) counts.status[status] = (counts.status[status] ?? 0) + 1;
  }
  if (status !== "active") return null;
  if (String(row[cols.value_currency] ?? "").trim().toUpperCase() !== "NGN") return null;
  const value = Number(String(row[cols.value_amount] ?? "").trim());
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = isoDate(row[cols.dateSigned]);
  if (!date || date > today || date < "2015-01-01") return null;
  if (counts) counts.usable++;
  return { id: String(row[cols.id] ?? "").trim(), date, value, themes: themesOf(String(row[cols.title] ?? "")) };
}

/** Pure: the newest month with at least `minAwards` contracts, as the newest signing date in that month; null when no month qualifies. */
export function newestDenseDate(contracts: NgContract[], minAwards = MIN_MONTH_AWARDS): string | null {
  const byMonth = new Map<string, { n: number; newest: string }>();
  for (const c of contracts) {
    const m = c.date.slice(0, 7);
    const e = byMonth.get(m);
    if (e) {
      e.n++;
      if (c.date > e.newest) e.newest = c.date;
    } else byMonth.set(m, { n: 1, newest: c.date });
  }
  const dense = [...byMonth.entries()].filter(([, e]) => e.n >= minAwards).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return dense.length ? dense[0][1].newest : null;
}

/** Pure: library rows for all contracts and for each theme with at least 5 distinct contracts in the window. */
export function aggregateAll(contracts: Iterable<NgContract>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  const add = (item: string, v: number) => {
    const g = groups.get(item);
    if (g) g.push(v);
    else groups.set(item, [v]);
  };
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.id) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
    }
    add("all", c.value);
    for (const t of c.themes) add(ITEM_PREFIX + t, c.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export type Opener = (url: string) => Promise<AsyncIterable<Uint8Array>>;

async function openHttp(url: string): Promise<AsyncIterable<Uint8Array>> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    signal: AbortSignal.timeout(9 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new SourceError(`The Nigeria contracts file answered HTTP ${res.status}`);
  return Readable.fromWeb(res.body as any) as unknown as AsyncIterable<Uint8Array>;
}

export interface HarvestOptions {
  open?: Opener; // for tests: yields the gzip bytes
  gunzip?: boolean; // tests may pass an already-decompressed tar
  months?: number;
}

export async function ngHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const today = now.toISOString().slice(0, 10);
  const open = o.open ?? openHttp;
  const counts = newCounts();
  const contracts: NgContract[] = [];
  let cols: Record<string, number> | null = null;
  let header = true;
  const reader = new CsvReader((row) => {
    if (header) {
      header = false;
      cols = columnsOf(row.map((h) => h.replace(/^﻿/, "")));
      return;
    }
    const c = contractOf(row, cols!, today, counts);
    if (c) contracts.push(c);
  });
  const decoder = new TextDecoder("utf-8");
  let found = false;
  try {
    const raw = await open(DATA_URL);
    const tarStream: AsyncIterable<Uint8Array> = o.gunzip === false ? raw : (Readable.from(raw).pipe(createGunzip()) as unknown as AsyncIterable<Uint8Array>);
    found = await tarEntry(tarStream, TAR_ENTRY, (chunk) => reader.push(decoder.decode(chunk, { stream: true })));
    reader.end();
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not read the Nigeria contracts file (Open Contracting Partnership data registry)", String((err as any)?.message ?? err));
  }
  if (!found) throw new SourceError(`The Nigeria contracts archive has no ${TAR_ENTRY}: the format may have changed`);
  if (header) throw new SourceError("The Nigeria contracts file was empty");
  const to = newestDenseDate(contracts);
  if (!to) throw new SourceError(`The Nigeria contracts file has no month with ${MIN_MONTH_AWARDS} or more usable contracts (${counts.rows} rows read, ${counts.usable} usable): the format may have changed`);
  const from = windowStart(to, o.months ?? WINDOW_MONTHS);
  const rows = aggregateAll(contracts, from, to);
  if (!rows.some((r) => r.item === "all")) throw new SourceError("The Nigeria contracts file gave no figure for all contracts in the window");
  const marker = newestMarker(to);
  if (marker) rows.push(marker);
  const statuses = Object.entries(counts.status)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return {
    date: today,
    currency: CURRENCY,
    unit: UNIT,
    rows,
    note: `Contracts signed ${from} to ${to}; ${counts.rows} rows read, ${counts.usable} usable (active, naira, value from ${MIN_VALUE}); status counts: ${statuses}.`,
  };
}

// ---------- the answer ----------

export interface NgInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pure: which library item the words mean, from the items the library holds. */
export function resolveItem(what: string, items: string[]): { item: string; label: string } {
  const q = norm(what);
  if (!q) throw new InputError("Nigeria: say what was bought, for example 'vehicles', 'roads' or 'all'.");
  if (["all", "everything", "all contracts", "all awards"].includes(q)) return { item: "all", label: "all contracts" };
  const held = THEMES.filter((t) => items.includes(ITEM_PREFIX + t.id));
  const hit = held.find((t) => t.id === q || norm(t.label) === q || t.aliases.some((a) => norm(a) === q));
  if (hit) return { item: ITEM_PREFIX + hit.id, label: hit.label };
  const partial = held.filter((t) => norm(t.label).includes(q) || t.aliases.some((a) => norm(a).includes(q) || q.includes(norm(a))));
  if (partial.length === 1) return { item: ITEM_PREFIX + partial[0].id, label: partial[0].label };
  const list = (held.length ? held : THEMES).map((t) => t.id).join(", ");
  throw new InputError(`Nigeria: "${what}" is not one of the purchase themes in the federal contract awards. Use 'all' or one of: ${list}.`);
}

export async function ngContracts(input: NgInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Nigeria: cpv is not used; the contracts are grouped by purchase themes, so put the theme in what (for example 'vehicles').");
  if (input.buyer_area) throw new InputError("Nigeria: buyer_area is not used; the figures are for all federal public bodies together.");
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Nigerian contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const { item, label } = resolveItem(input.what, day.rows.map((r) => r.item));
  const newest = newestOf(day.rows);
  const to = newest && newest <= day.date ? newest : day.date;
  const from = windowStart(to);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "NG", what: input.what },
    summary,
    currency: CURRENCY,
    unit: UNIT,
    period: { from, to },
    method:
      `Nigerian federal contracts signed ${from} to ${to} (the newest month with at least ${MIN_MONTH_AWARDS} signed contracts; the portal records almost no newer awards; collected ${day.date}), theme: ${label}. ` +
      "Median and 10th–90th percentile of the contract value in naira. Totals per contract, not unit prices; themes are matched by keywords in the contract title; suppliers are never named.",
    describe: (s) =>
      `Nigerian federal public bodies signed contracts (${label}) with a median total value of ${fmtMoney(s.median, CURRENCY)} per contract ` +
      `(typical range ${fmtMoney(s.low, CURRENCY)} to ${fmtMoney(s.high, CURRENCY)}, 10th to 90th percentile). These are posted contract totals in naira, not unit prices, and the newest contract is from ${to}; with high inflation, older contracts look smaller.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (NOCOPO), not a unit price", theme: label, newest_collection: day.date, ...(newest ? { newest_award: newest } : {}) },
  });
}
