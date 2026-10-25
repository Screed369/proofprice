// The price library: daily aggregate rows per source, kept as small CSV files in library/<source>/daily/<YYYY-MM>.csv
// plus library/<source>/meta.json. Written once a day by the collector (scripts/harvest.ts on GitHub Actions),
// committed to git (so every day is kept forever), and shipped with each deployment, so reads are free and fast.
// Only aggregates are stored (median, 10th–90th percentile, count): never an individual record.
// To move to a database later, replace this file only; nothing else reads the files directly.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DailyRow, HarvestResult } from "../plugin";
import { NO_COUNT, passesGate } from "../stats";

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
  /** Data checker: held medians seen so far per "area::item" (accepted after 3 distinct days at the same level). */
  held_streak?: Record<string, { median: number; dates: string[] }>;
}

export function libraryRoot(): string {
  return process.env.PROOFPRICE_LIBRARY_DIR || path.join(process.cwd(), "library");
}

function sourceDir(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId)) throw new Error(`Bad source id: ${sourceId}`);
  return path.join(libraryRoot(), sourceId);
}

function csvCell(v: string | number): string {
  if (typeof v === "number" && Number.isNaN(v)) return ""; // an empty cell is a missing record count (n only)
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
    return { date, area, item, n: n === undefined || n.trim() === "" ? NO_COUNT : Number(n), median: Number(median), low: Number(low), high: Number(high), min: Number(min), max: Number(max) };
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
  const fresh = result.rows.filter((r) => passesGate(r.n)).map((r) => ({ ...r, date: result.date }));
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

/** Every row of the given days (any area, any item). Reads only the month files those days fall in. Used by /this-week. */
export function readRowsOnDates(sourceId: string, dates: string[]): LibraryRow[] {
  const dir = path.join(sourceDir(sourceId), "daily");
  if (!existsSync(dir) || !dates.length) return [];
  const want = new Set(dates);
  const months = new Set(dates.map((d) => d.slice(0, 7)));
  const out: LibraryRow[] = [];
  for (const month of months) {
    const file = path.join(dir, `${month}.csv`);
    if (!existsSync(file)) continue;
    for (const r of csvToRows(readFileSync(file, "utf8"))) if (want.has(r.date)) out.push(r);
  }
  return out;
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

// ---------- outside check results (library/_crosscheck/, written only by scripts/crosscheck.ts on GitHub Actions) ----------
// One CSV per source: our figure next to the publisher's headline figure, one row per area and release, and a meta.json with the
// state of every source's last run. The folder name starts with "_" so it is never mistaken for a source (libraryStatus skips it).

export const CROSSCHECK_HEADER = "checked_at,area,their_key,their_period,their_value,our_period,our_value,gap_pct,our_n,their_n,verdict,reason";

export interface CrossCheckRow {
  checked_at: string; // YYYY-MM-DD
  area: string; // the area label
  their_key: string;
  their_period: string;
  their_value: number;
  our_period: string;
  our_value: number;
  gap_pct: number; // (ours - theirs) / theirs * 100, rounded to 0.01
  our_n: number | null;
  their_n: number | null;
  verdict: "AGREES" | "EXPLAINED" | "SUSPECT";
  reason: string;
}

export interface CrossCheckMeta {
  source: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  /** Why the last run could not compare (link moved, download failed, periods differ...). Null when it compared. */
  last_error: string | null;
  /** Runs in a row in which the publisher's file could not be read. The workflow fails (one email) when this reaches 3. */
  consecutive_failures: number;
  last_rows_written: number;
  notes: string[];
}

export function crossCheckDir(): string {
  return path.join(libraryRoot(), "_crosscheck");
}

function crossCheckFile(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId)) throw new Error(`Bad source id: ${sourceId}`);
  return path.join(crossCheckDir(), `${sourceId}.csv`);
}

const numOrNull = (v: string | undefined): number | null => (v === undefined || v.trim() === "" ? null : Number(v));

export function crossCheckRowsToCsv(rows: CrossCheckRow[]): string {
  const body = rows.map((r) =>
    [r.checked_at, r.area, r.their_key, r.their_period, r.their_value, r.our_period, r.our_value, r.gap_pct, r.our_n ?? "", r.their_n ?? "", r.verdict, r.reason]
      .map((v) => csvCell(v as string | number))
      .join(","),
  );
  return [CROSSCHECK_HEADER, ...body].join("\n") + "\n";
}

export function csvToCrossCheckRows(text: string): CrossCheckRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || lines[0].trim() !== CROSSCHECK_HEADER) return [];
  return lines.slice(1).map((l) => {
    const c = splitCsvLine(l);
    return {
      checked_at: c[0], area: c[1], their_key: c[2], their_period: c[3], their_value: Number(c[4]), our_period: c[5], our_value: Number(c[6]),
      gap_pct: Number(c[7]), our_n: numOrNull(c[8]), their_n: numOrNull(c[9]), verdict: c[10] as CrossCheckRow["verdict"], reason: c[11] ?? "",
    };
  });
}

export function readCrossCheck(sourceId: string): CrossCheckRow[] {
  const file = crossCheckFile(sourceId);
  return existsSync(file) ? csvToCrossCheckRows(readFileSync(file, "utf8")) : [];
}

/** Add rows, keeping one row per area and release (their_key + their_period): a re-run never duplicates a comparison. */
export function appendCrossCheck(sourceId: string, rows: CrossCheckRow[]): number {
  const existing = readCrossCheck(sourceId);
  const seen = new Set(existing.map((r) => `${r.their_key}|${r.their_period}`));
  const fresh = rows.filter((r) => !seen.has(`${r.their_key}|${r.their_period}`));
  if (!fresh.length) return 0;
  mkdirSync(crossCheckDir(), { recursive: true });
  writeFileSync(crossCheckFile(sourceId), crossCheckRowsToCsv([...existing, ...fresh]));
  return fresh.length;
}

export function readCrossCheckMeta(): Record<string, CrossCheckMeta> {
  const file = path.join(crossCheckDir(), "meta.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function writeCrossCheckMeta(meta: Record<string, CrossCheckMeta>): void {
  mkdirSync(crossCheckDir(), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path.join(crossCheckDir(), "meta.json"), JSON.stringify(sorted, null, 2) + "\n");
}
