// Loading past data into the price library. A source supplies backfill(from, to) returning aggregates per period;
// this file is the only code that writes them. Rules, all enforced here and unit-tested:
//  - aggregates only: median / 10th / 90th percentile / min / max / count; rows with fewer than 5 records are dropped;
//    area and item are short labels (never free text that could carry an address or a name);
//  - periods older than 90 days must be monthly ("YYYY-MM"); a day ("YYYY-MM-DD") is accepted only inside the last 90 days;
//  - monthly history lives in library/<source>/history/<YYYY>.csv (same columns as the daily files, date = "YYYY-MM"), so it can
//    never touch the daily files or meta.json the collector owns; days inside the last 90 days go to the daily files only when
//    that day is not already held (a harvested day is never replaced);
//  - size budget: at most 5 MB of history added per source and 25 MB in total, checked BEFORE anything is written;
//  - idempotent: running the same backfill twice leaves the same files.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BackfillResult, DailyRow } from "../plugin";
import { passesGate } from "../stats";
import { DAILY_HEADER, csvToRows, libraryDates, libraryRoot, readMeta, rowsToCsv, writeDaily } from "./store";
import type { LibraryRow } from "./store";

export const DETAIL_DAYS = 90;
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
// Short labels only (a county, a department code, "Dublin 6W", "diesel/served"): at most 3 words, 40 characters, and never a number
// followed by a word (which is how a street address starts). Sources use the labels their harvest() already writes.
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._\-\/+()]{0,23}( [A-Za-z0-9._\-\/+()]{1,15}){0,2}$/;
const ADDRESS_LIKE = /\d\s+[A-Za-z]{3,}/;

export interface BackfillReport {
  source: string;
  monthly_rows: number;
  daily_rows: number;
  dropped_thin: number;
  dropped_invalid: number;
  skipped_held_days: number;
  skipped_too_detailed: number;
  bytes_added: number;
  source_history_bytes: number;
  total_history_bytes: number;
  periods: { first: string | null; last: string | null; count: number };
}

export interface HistoryMeta {
  source: string;
  currency: string;
  unit: string;
  first_period: string | null;
  last_period: string | null;
  periods: number;
  rows: number;
  last_backfill_at: string;
  note?: string | null;
}

function srcDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Bad source id: ${id}`);
  return path.join(libraryRoot(), id);
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return n;
}

/** Bytes of history held for one source (history/ plus history-meta.json). */
export function sourceHistoryBytes(id: string): number {
  const f = path.join(srcDir(id), "history-meta.json");
  return dirBytes(path.join(srcDir(id), "history")) + (existsSync(f) ? statSync(f).size : 0);
}

/** Bytes of history held for every source. */
export function totalHistoryBytes(): number {
  const root = libraryRoot();
  if (!existsSync(root)) return 0;
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(d.name))
    .reduce((n, d) => n + sourceHistoryBytes(d.name), 0);
}

const isMonth = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const isDay = (p: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p) && new Date(p + "T00:00:00Z").toISOString().slice(0, 10) === p;

/** The oldest day that may still be stored as a day (inclusive). */
export function detailCutoff(today: Date): string {
  return new Date(today.getTime() - DETAIL_DAYS * 86400000).toISOString().slice(0, 10);
}

function validRow(r: DailyRow): boolean {
  const nums = [r.median, r.low, r.high, r.min, r.max];
  if (!nums.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  if (!(r.median > 0) || !(Number.isInteger(r.n) || Number.isNaN(r.n))) return false; // NaN (NO_COUNT) = the publisher gives no record count
  if (!(r.min <= r.low && r.low <= r.median && r.median <= r.high && r.high <= r.max)) return false;
  return typeof r.area === "string" && typeof r.item === "string" && LABEL.test(r.area) && LABEL.test(r.item) && !ADDRESS_LIKE.test(r.area) && !ADDRESS_LIKE.test(r.item);
}

export function readHistoryMeta(id: string): HistoryMeta | null {
  const f = path.join(srcDir(id), "history-meta.json");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

function sortRows(rows: LibraryRow[]): LibraryRow[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

function loadYear(file: string): LibraryRow[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  if (text.trim() && text.split(/\r?\n/)[0].trim() !== DAILY_HEADER) throw new Error(`${file} has an unexpected header; refusing to overwrite`);
  return csvToRows(text);
}

/** Apply a source's past aggregates to the library. `dryRun` measures and reports without writing. */
export function applyBackfill(sourceId: string, result: BackfillResult, opts: { today?: Date; dryRun?: boolean; from?: string; to?: string } = {}): BackfillReport {
  const today = opts.today ?? new Date();
  const cutoff = detailCutoff(today);
  const todayStr = today.toISOString().slice(0, 10);
  const dir = path.join(srcDir(sourceId), "history");
  const rep: BackfillReport = {
    source: sourceId, monthly_rows: 0, daily_rows: 0, dropped_thin: 0, dropped_invalid: 0, skipped_held_days: 0,
    skipped_too_detailed: 0, bytes_added: 0, source_history_bytes: 0, total_history_bytes: 0, periods: { first: null, last: null, count: 0 },
  };
  // same currency and unit as the collector's own figures: backfilled days share its files
  const meta0 = readMeta(sourceId);
  if (meta0 && ((meta0.currency && meta0.currency !== result.currency) || (meta0.unit && meta0.unit !== result.unit))) {
    throw new Error(`Currency/unit mismatch for ${sourceId}: library has ${meta0.currency} ${meta0.unit}, backfill gave ${result.currency} ${result.unit}. Nothing written.`);
  }
  const monthlyByYear = new Map<string, LibraryRow[]>();
  const dailyByDate = new Map<string, DailyRow[]>();
  const seen = new Set<string>();
  const held = new Set(libraryDates(sourceId));

  for (const p of result.periods) {
    const month = isMonth(p.period);
    const day = isDay(p.period);
    if (!month && !day) {
      rep.dropped_invalid += p.rows.length;
      continue;
    }
    // outside the requested range: ignored (a source must not load more than it was asked for)
    if ((opts.from && p.period.slice(0, month ? 7 : 10) < opts.from.slice(0, month ? 7 : 10)) || (opts.to && p.period.slice(0, month ? 7 : 10) > opts.to.slice(0, month ? 7 : 10))) {
      rep.dropped_invalid += p.rows.length;
      continue;
    }
    const clean: DailyRow[] = [];
    for (const r of p.rows) {
      if (!validRow(r)) rep.dropped_invalid++;
      else if (!passesGate(r.n)) rep.dropped_thin++;
      else clean.push(r);
    }
    if (!clean.length) continue;
    if (day) {
      if (p.period < cutoff || p.period > todayStr) { rep.skipped_too_detailed += clean.length; continue; } // old days must be monthly
      if (held.has(p.period)) { rep.skipped_held_days += clean.length; continue; } // the daily collector owns held days
      const have = dailyByDate.get(p.period) ?? [];
      const byKey = new Map(have.concat(clean).map((r) => [`${r.area}\u0000${r.item}`, r] as const)); // one row per area and item
      dailyByDate.set(p.period, [...byKey.values()]);
    } else {
      // a month still running is incomplete, so only whole past months are stored
      if (p.period >= todayStr.slice(0, 7)) { rep.dropped_invalid += clean.length; continue; }
      const year = p.period.slice(0, 4);
      const list = monthlyByYear.get(year) ?? [];
      for (const r of clean) list.push({ ...r, date: p.period });
      monthlyByYear.set(year, list);
    }
    seen.add(p.period);
  }

  // build the new file contents first (idempotent merge by date, area, item), then check the budget, then write
  const planned = new Map<string, string>();
  let addedBytes = 0;
  for (const [year, fresh] of monthlyByYear) {
    const file = path.join(dir, `${year}.csv`);
    const key = (r: LibraryRow) => `${r.date}\u0000${r.area}\u0000${r.item}`;
    const merged = new Map(loadYear(file).map((r) => [key(r), r] as const));
    for (const r of fresh) merged.set(key(r), r);
    const text = rowsToCsv(sortRows([...merged.values()]));
    planned.set(file, text);
    addedBytes += Math.max(0, Buffer.byteLength(text) - (existsSync(file) ? statSync(file).size : 0));
    rep.monthly_rows += fresh.length;
  }
  for (const [date, rows] of dailyByDate) {
    const f = path.join(srcDir(sourceId), "daily", `${date.slice(0, 7)}.csv`);
    if (existsSync(f)) { // header check before any write, so a bad daily file stops the run with nothing written
      const t = readFileSync(f, "utf8");
      if (t.trim() && t.split(/\r?\n/)[0].trim() !== DAILY_HEADER) throw new Error(`${f} has an unexpected header; refusing to overwrite stored history`);
    }
    addedBytes += rows.length * 60; // upper-bound estimate of a daily row (counted against the history budget: errs on the cautious side)
    rep.daily_rows += rows.length;
  }
  const before = sourceHistoryBytes(sourceId);
  const totalBefore = totalHistoryBytes();
  rep.bytes_added = addedBytes;
  rep.source_history_bytes = before + addedBytes;
  rep.total_history_bytes = totalBefore + addedBytes;
  if (before + addedBytes > MAX_SOURCE_BYTES) throw new Error(`Size budget: ${sourceId} history would be ${(rep.source_history_bytes / 1048576).toFixed(2)} MB (limit 5 MB). Nothing written.`);
  if (totalBefore + addedBytes > MAX_TOTAL_BYTES) throw new Error(`Size budget: all history would be ${(rep.total_history_bytes / 1048576).toFixed(2)} MB (limit 25 MB). Nothing written.`);
  const sorted = [...seen].sort();
  rep.periods = { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, count: sorted.length };
  if (opts.dryRun || (!planned.size && !dailyByDate.size)) return rep;

  mkdirSync(dir, { recursive: true });
  for (const [file, text] of planned) writeFileSync(file, text);
  for (const [date, rows] of dailyByDate) writeDaily(sourceId, { date, currency: result.currency, unit: result.unit, rows });
  const prev = readHistoryMeta(sourceId);
  const first = [prev?.first_period, rep.periods.first].filter(Boolean).sort()[0] ?? null;
  const last = [prev?.last_period, rep.periods.last].filter(Boolean).sort().reverse()[0] ?? null;
  const all = readdirSync(dir).filter((f) => /^\d{4}\.csv$/.test(f)).flatMap((f) => csvToRows(readFileSync(path.join(dir, f), "utf8")));
  const rowCount = all.length;
  const periodCount = new Set(all.map((r) => r.date)).size;
  const meta: HistoryMeta = {
    source: sourceId, currency: result.currency, unit: result.unit, first_period: first, last_period: last,
    periods: periodCount,
    rows: rowCount, last_backfill_at: today.toISOString(), note: result.note ?? null,
  };
  writeFileSync(path.join(srcDir(sourceId), "history-meta.json"), JSON.stringify(meta, null, 2) + "\n");
  // the real size on disk after writing (what the workflow reports)
  rep.source_history_bytes = sourceHistoryBytes(sourceId);
  rep.total_history_bytes = totalHistoryBytes();
  return rep;
}

/** Read monthly history for one area and item. Period "YYYY-MM"; returned in `date`. */
export function readMonthly(sourceId: string, q: { area: string; item: string; from: string; to: string }): LibraryRow[] {
  const dir = path.join(srcDir(sourceId), "history");
  if (!existsSync(dir)) return [];
  const out: LibraryRow[] = [];
  for (let y = Number(q.from.slice(0, 4)); y <= Number(q.to.slice(0, 4)); y++) {
    for (const r of loadYear(path.join(dir, `${y}.csv`))) {
      if (r.area === q.area && r.item === q.item && r.date >= q.from.slice(0, 7) && r.date <= q.to.slice(0, 7)) out.push(r);
    }
  }
  return sortRows(out);
}
