// The price library: daily aggregate rows per source, kept as small CSV files in library/<source>/daily/<YYYY-MM>.csv
// plus library/<source>/meta.json. Written once a day by the collector (scripts/harvest.ts on GitHub Actions),
// committed to git (so every day is kept forever), and shipped with each deployment, so reads are free and fast.
// Only aggregates are stored (median, 10th–90th percentile, count): never an individual record.
// To move to a database later, replace this file only; nothing else reads the files directly.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DailyRow, HarvestResult } from "../plugin";
import { MIN_PUBLISH } from "../stats";

export const DAILY_HEADER = "date,area,item,n,median,low,high,min,max";

export interface LibraryRow extends DailyRow {
  date: string;
}

export interface SourceMeta {
  source: string;
  currency: string | null;
  unit: string | null;
  first_date: string | null;
  last_date: string | null;
  days: number;
  last_harvest_at: string | null;
  last_rows: number;
  last_ok_at: string | null;
  last_error: string | null;
  note?: string | null;
}

export function libraryRoot(): string {
  return process.env.PROOFPRICE_LIBRARY_DIR || path.join(process.cwd(), "library");
}

function sourceDir(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId)) throw new Error(`Bad source id: ${sourceId}`);
  return path.join(libraryRoot(), sourceId);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

export function rowsToCsv(rows: LibraryRow[]): string {
  const body = rows.map((r) => [r.date, r.area, r.item, r.n, r.median, r.low, r.high, r.min, r.max].map(csvCell).join(","));
  return [DAILY_HEADER, ...body].join("\n") + "\n";
}

export function csvToRows(text: string): LibraryRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || lines[0].trim() !== DAILY_HEADER) return [];
  return lines.slice(1).map((l) => {
    const [date, area, item, n, median, low, high, min, max] = splitCsvLine(l);
    return { date, area, item, n: Number(n), median: Number(median), low: Number(low), high: Number(high), min: Number(min), max: Number(max) };
  });
}

function sortRows(rows: LibraryRow[]): LibraryRow[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

/** Add (or replace) one day of aggregates for a source. Idempotent: running twice on a day keeps one copy. */
export function writeDaily(sourceId: string, result: HarvestResult): { file: string; rows: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) throw new Error(`Bad harvest date: ${result.date}`);
  const dir = path.join(sourceDir(sourceId), "daily");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${result.date.slice(0, 7)}.csv`);
  const fresh = result.rows.filter((r) => r.n >= MIN_PUBLISH).map((r) => ({ ...r, date: result.date }));
  if (!fresh.length) return { file, rows: 0 }; // never replace a good day with nothing
  let existing: LibraryRow[] = [];
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    if (text.trim() && text.split(/\r?\n/)[0].trim() !== DAILY_HEADER) {
      throw new Error(`${file} has an unexpected header; refusing to overwrite stored history`);
    }
    existing = csvToRows(text);
  }
  const keep = existing.filter((r) => r.date !== result.date);
  writeFileSync(file, rowsToCsv(sortRows([...keep, ...fresh])));
  return { file, rows: fresh.length };
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 240) break;
  }
  return out;
}

/** Read daily rows for one area and item between two dates (inclusive). */
export function readDaily(sourceId: string, q: { area: string; item: string; from: string; to: string }): LibraryRow[] {
  const dir = path.join(sourceDir(sourceId), "daily");
  if (!existsSync(dir)) return [];
  const out: LibraryRow[] = [];
  for (const month of monthsBetween(q.from, q.to)) {
    const file = path.join(dir, `${month}.csv`);
    if (!existsSync(file)) continue;
    for (const r of csvToRows(readFileSync(file, "utf8"))) {
      if (r.area === q.area && r.item === q.item && r.date >= q.from && r.date <= q.to) out.push(r);
    }
  }
  return sortRows(out);
}

/** Every date we hold for a source. Reads every month file: use in the collector, not per request. */
export function libraryDates(sourceId: string): string[] {
  const dir = path.join(sourceDir(sourceId), "daily");
  if (!existsSync(dir)) return [];
  const dates = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
    for (const r of csvToRows(readFileSync(path.join(dir, f), "utf8"))) dates.add(r.date);
  }
  return [...dates].sort();
}

/** The newest day held for a source: every aggregate row of that day. Reads only the newest non-empty month file,
 *  so it is cheap enough for building the static answer pages (one call per source). Returns null if nothing is stored. */
export function readLatestDay(sourceId: string): { date: string; rows: LibraryRow[] } | null {
  const dir = path.join(sourceDir(sourceId), "daily");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.csv$/.test(f))
    .sort()
    .reverse();
  for (const f of files) {
    const rows = csvToRows(readFileSync(path.join(dir, f), "utf8"));
    if (!rows.length) continue;
    const date = rows.reduce((a, r) => (r.date > a ? r.date : a), "");
    return { date, rows: rows.filter((r) => r.date === date) };
  }
  return null;
}

export function readMeta(sourceId: string): SourceMeta | null {
  const file = path.join(sourceDir(sourceId), "meta.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeMeta(sourceId: string, meta: SourceMeta): void {
  const dir = sourceDir(sourceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
}

/** Status of every source in the library, for /api/v1/library and the Monitor. */
export function libraryStatus(): SourceMeta[] {
  const root = libraryRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(d.name))
    .map((d) => readMeta(d.name))
    .filter((m): m is SourceMeta => !!m)
    .sort((a, b) => a.source.localeCompare(b.source));
}
