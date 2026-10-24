// Argentine public contract award values from the national electronic procurement system (COMPR.AR / Contrat.Ar), Oficina Nacional de Contrataciones,
// Jefatura de Gabinete de Ministros, published on datos.gob.ar as dataset "sistema-de-contrataciones-electronicas", licence "Creative Commons Attribution 4.0"
// (the publisher's own CKAN API, package_show, read 2026-10-24).
// Format proven 2026-10-24 from GitHub's servers (probe arcontr1): GET https://infra.datos.gob.ar/catalog/jgm/dataset/4/distribution/4.22/download/Adjudicaciones.csv
//   200, text/csv, 87.9 MB, UTF-8, comma separated, sorted by year ascending (2016 first), Last-Modified 2026-08-03 (the publisher refreshes it about twice a year).
//   Header: Numero_Proceso,Nro_SAF,Descripcion_SAF,Nro_UOC,Descripcion_UOC,Unidad_Ejecutora,Tipo_de_Procedimiento,Modalidad,Apartado_Directa,Ejercicio,
//   Fecha_de_Adjudicacion,Rubros,CUIT,Descripcion_Proveedor,Documento_Contractual,Tipo,Monto,Moneda,Tipo_de_Operacion,Fecha_de_perfeccionamiento_OC
//   Row example: 23-0019-LPU16,301,...,Licitacion Pública,Sin Modalidad,,2016,28/12/2016 04:05:45 p.m.,MANT. REPARACION Y LIMPIEZA;,20-23050606-0,<supplier>,
//   23-1004-OC16,Original,1230000.00,Peso Argentino,Proceso de Compra,28/12/2016 12:00:00 a.m.   (also seen: Moneda "Dolar Estadounidense")
// Suppliers (CUIT, name) are sole traders in many cases: they are never read into the library. Only the date, the value, the currency, the type and the
// product groups (Rubros, a semicolon list) are used; Documento_Contractual is used only to count an award once.
// The file is far too big to download per request: harvest() streams it once a day and keeps aggregates only.
import { Readable } from "node:stream";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";

export const INFO: SourceInfo = {
  id: "ar-contrataciones",
  country: "AR (national public bodies on COMPR.AR)",
  category: "government contracts (awarded contracts)",
  name: "COMPR.AR: Argentine national public procurement awards (Oficina Nacional de Contrataciones)",
  publisher: "Jefatura de Gabinete de Ministros, Oficina Nacional de Contrataciones (COMPR.AR), published on datos.gob.ar",
  what_is_recorded:
    "Contracts that Argentine national public bodies awarded through the electronic procurement system: the award date, the product groups (rubros) and the awarded value in pesos.",
  price_type: "contract_price",
  freshness: "Twice a year: the publisher refreshes the file about every six months, so the newest awards can be months old",
  licence: "Creative Commons Attribution 4.0 (datos.gob.ar)",
  licence_url: "https://datos.gob.ar/dataset/jgm-sistema-contrataciones-electronicas",
  attribution:
    "Source: Jefatura de Gabinete de Ministros, Oficina Nacional de Contrataciones (COMPR.AR), via datos.gob.ar, CC BY 4.0. Figures are ProofPrice aggregates of the published awards.",
  homepage: "https://datos.gob.ar/dataset/jgm-sistema-contrataciones-electronicas",
  limits:
    "Awarded values in Argentine pesos over the whole contract (not unit prices, not amounts paid yet); with Argentine inflation, compare figures from different months with care. " +
    "Only awards in pesos and of the original type are used (other currencies and later changes to an award are left out), an award is counted once, and values under 1,000 pesos (placeholders) are dropped. " +
    "An award that lists several product groups (rubros) counts in each of them. Only national public bodies on COMPR.AR are covered, not provinces or municipalities. " +
    "Aggregates only; suppliers and their tax numbers in the open file are never read or kept.",
  method_version: "1",
};

export const DATA_URL = "https://infra.datos.gob.ar/catalog/jgm/dataset/4/distribution/4.22/download/Adjudicaciones.csv";
export const WINDOW_MONTHS = 12;
export const MIN_VALUE = 1000;
export const MAX_VALUE = 1e14;
export const CURRENCY = "ARS";
export const UNIT = "per award, total awarded value";

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** "28/12/2016 04:05:45 p.m." to "2016-12-28", or "" when it is not a real date. */
export function isoDate(s: unknown): string {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s ?? ""));
  if (!m) return "";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? "" : iso;
}

/** Lower case, no accents, letters and digits only, single spaces: "MANT. REPARACION Y LIMPIEZA" to "mant reparacion y limpieza". */
export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const ITEM_PREFIX = "r:";
export function rubroItems(rubros: string): string[] {
  const out = new Set<string>();
  for (const part of String(rubros ?? "").split(";")) {
    const n = norm(part);
    if (n) out.add(ITEM_PREFIX + n);
  }
  return [...out];
}

/** Streaming CSV reader: feed text pieces in order; calls onRow with the fields of each finished record. Handles quotes, doubled quotes and line breaks inside quotes. */
export class CsvReader {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false; // saw a quote while inside quotes: either the end or a doubled quote
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
        this.inQuotes = false; // the quote ended the quoted part; c is handled below
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
    if (r.length === 1 && r[0] === "") return; // blank line
    this.onRow(r);
  }
}

export interface ArAward {
  key: string;
  date: string;
  value: number;
  items: string[];
}

/** Why a row was left out, counted in the harvest note so a format change is visible. */
export interface Counts {
  rows: number;
  usable: number;
  tipo: Record<string, number>;
  moneda: Record<string, number>;
  other: number;
}

export function newCounts(): Counts {
  return { rows: 0, usable: 0, tipo: {}, moneda: {}, other: 0 };
}

const REQUIRED = ["Fecha_de_Adjudicacion", "Rubros", "Documento_Contractual", "Tipo", "Monto", "Moneda"];

/** Maps header names (accent- and case-insensitive, underscores or spaces) to column positions. Throws if a needed column is missing. */
export function columnsOf(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[norm(h)] = i));
  const out: Record<string, number> = {};
  for (const name of REQUIRED) {
    const i = idx[norm(name)];
    if (i === undefined) throw new SourceError(`The COMPR.AR file has no column "${name}": the format may have changed`);
    out[name] = i;
  }
  return out;
}

/** Pure: one CSV row to an award, or null (not an original award, not pesos, placeholder or entry error, bad date, no product group, outside the window). */
export function awardOf(row: string[], cols: Record<string, number>, from: string, to: string, counts?: Counts): ArAward | null {
  if (counts) {
    counts.rows++;
    const t = norm(row[cols.Tipo]) || "(empty)";
    const m = norm(row[cols.Moneda]) || "(empty)";
    // only rows inside the window feed the type and currency counts (the file holds ten years)
    const d = isoDate(row[cols.Fecha_de_Adjudicacion]);
    if (d && d >= from && d <= to) {
      if (counts.tipo[t] !== undefined || Object.keys(counts.tipo).length < 12) counts.tipo[t] = (counts.tipo[t] ?? 0) + 1;
      if (counts.moneda[m] !== undefined || Object.keys(counts.moneda).length < 12) counts.moneda[m] = (counts.moneda[m] ?? 0) + 1;
    }
  }
  if (norm(row[cols.Tipo]) !== "original") return null;
  if (!norm(row[cols.Moneda]).startsWith("peso")) return null;
  const value = Number(String(row[cols.Monto] ?? "").trim());
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = isoDate(row[cols.Fecha_de_Adjudicacion]);
  if (!date || date < from || date > to) return null;
  const items = rubroItems(row[cols.Rubros]);
  if (!items.length) return null;
  if (counts) counts.usable++;
  return { key: String(row[cols.Documento_Contractual] ?? "").trim(), date, value, items };
}

/** Pure: library rows for the whole country and for every product group that has at least 5 distinct awards. */
export function aggregateAll(awards: Iterable<ArAward>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  const add = (item: string, v: number) => {
    const g = groups.get(item);
    if (g) g.push(v);
    else groups.set(item, [v]);
  };
  for (const a of awards) {
    if (a.date < from || a.date > to) continue;
    if (a.key) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
    }
    add("all", a.value);
    for (const item of a.items) add(item, a.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export type Opener = (url: string) => Promise<AsyncIterable<Uint8Array | string>>;

async function openHttp(url: string): Promise<AsyncIterable<Uint8Array | string>> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    signal: AbortSignal.timeout(9 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new SourceError(`The COMPR.AR file answered HTTP ${res.status}`);
  return Readable.fromWeb(res.body as any) as unknown as AsyncIterable<Uint8Array>;
}

export interface HarvestOptions {
  open?: Opener; // for tests
  months?: number;
}

function countsText(c: Counts): string {
  const top = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  return `rows in window by type: ${top(c.tipo) || "none"}; by currency: ${top(c.moneda) || "none"}`;
}

export async function arHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to, o.months ?? WINDOW_MONTHS);
  const open = o.open ?? openHttp;
  const counts = newCounts();
  const awards: ArAward[] = [];
  let cols: Record<string, number> | null = null;
  let header = true;
  let newest = "";
  const reader = new CsvReader((row) => {
    if (header) {
      header = false;
      cols = columnsOf(row.map((h) => h.replace(/^﻿/, "")));
      return;
    }
    const a = awardOf(row, cols!, from, to, counts);
    if (a) {
      awards.push(a);
      if (a.date > newest) newest = a.date;
    }
  });
  const decoder = new TextDecoder("utf-8");
  try {
    for await (const piece of await open(DATA_URL)) reader.push(typeof piece === "string" ? piece : decoder.decode(piece, { stream: true }));
    reader.end();
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not read the COMPR.AR file (datos.gob.ar)", String((err as any)?.message ?? err));
  }
  if (header) throw new SourceError("The COMPR.AR file was empty");
  if (!awards.length) throw new SourceError(`The COMPR.AR file held no usable awards in the window (${countsText(counts)}): the file may not have been refreshed or its format may have changed`);
  const rows = aggregateAll(awards, from, to);
  return {
    date: to,
    currency: CURRENCY,
    unit: UNIT,
    rows,
    note: `Awards ${from} to ${to}; ${counts.rows} rows read, ${awards.length} usable (peso, original type), newest award ${newest}; ${countsText(counts)}.`,
  };
}

// ---------- the answer ----------

/** English words for the common purchases to a part of the rubro name (rubros are Spanish, in capitals). */
export const SYNONYMS: Record<string, string> = {
  laptop: "informatica",
  laptops: "informatica",
  computer: "informatica",
  computers: "informatica",
  "it equipment": "informatica",
  software: "informatica",
  food: "alimentos",
  groceries: "alimentos",
  cleaning: "limpieza",
  insurance: "seguros",
  banking: "bancos",
  printing: "imprenta",
  stationery: "libreria",
  "office supplies": "libreria",
  tools: "herramientas",
  hardware: "ferreteria",
  medicines: "medico",
  medical: "medico",
  pharmaceuticals: "medico",
  "spare parts": "repuestos",
  electricity: "electricidad",
  telephony: "telefonia",
  utilities: "servicios basicos",
  "professional services": "serv profesional",
};

export interface ArInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

function labelOf(item: string): string {
  return item.replace(ITEM_PREFIX, "");
}

/** Pure: which library item the words mean, from the items the library holds. */
export function resolveItem(what: string, items: string[]): { item: string; label: string } {
  const q = norm(what);
  if (!q) throw new InputError("Argentina: say what was bought, for example 'informatica' (IT equipment), 'alimentos' (food) or 'all'.");
  if (["all", "everything", "todo", "todos", "all awards", "todas"].includes(q)) return { item: "all", label: "all awards" };
  const groups = items.filter((i) => i.startsWith(ITEM_PREFIX));
  const exact = groups.find((i) => labelOf(i) === q);
  if (exact) return { item: exact, label: labelOf(exact) };
  const needle = SYNONYMS[q] ?? q;
  const hits = groups.filter((i) => labelOf(i).includes(needle));
  if (hits.length === 1) return { item: hits[0], label: labelOf(hits[0]) };
  if (hits.length > 1) {
    const shortest = [...hits].sort((a, b) => a.length - b.length);
    if (shortest[0].length < shortest[1].length && labelOf(shortest[0]) === needle) return { item: shortest[0], label: labelOf(shortest[0]) };
    throw new InputError(`Argentina: "${what}" matches several product groups (${hits.map(labelOf).slice(0, 8).join("; ")}). Name one of them.`);
  }
  const list = groups.map(labelOf).slice(0, 40).join("; ");
  throw new InputError(
    `Argentina: "${what}" is not one of the product groups (rubros) in the COMPR.AR awards. Use 'all' or one of: ${list || "(none collected yet)"}.`,
  );
}

export async function arContracts(input: ArInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Argentina: cpv is not used; COMPR.AR groups purchases by its own product groups (rubros), so put the group in what.");
  if (input.buyer_area) throw new InputError("Argentina: buyer_area is not used; the figures are for all national public bodies together.");
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Argentine contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const { item, label } = resolveItem(input.what, day.rows.map((r) => r.item));
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "AR", what: input.what },
    summary,
    currency: CURRENCY,
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `COMPR.AR awards dated ${from} to ${day.date} (the publisher refreshes the file about twice a year), product group: ${label}. Median and 10th–90th percentile of the awarded value in Argentine pesos. ` +
      "Totals per award, not unit prices; suppliers are never named.",
    describe: (s) =>
      `Argentine national public bodies awarded contracts (${label}) with a median total value of ${fmtMoney(s.median, CURRENCY)} per award ` +
      `(typical range ${fmtMoney(s.low, CURRENCY)} to ${fmtMoney(s.high, CURRENCY)}, 10th to 90th percentile). These are totals per award in pesos, not unit prices; with high inflation, older awards look smaller.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value (COMPR.AR), not a unit price", product_group: label, newest_collection: day.date },
  });
}
