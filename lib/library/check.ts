// The data checker: runs in the collector (scripts/harvest.ts) before a day's aggregates are written to the price library.
// For every key (area + item) it compares the new median with the previous stored one. A median above 3x or below a third of
// the previous value, or a change of currency or unit, is more likely a broken feed than a real price move: that key is NOT
// published (the previous value stays in the library) and the reason is recorded in meta.json (last_error), which
// /api/v1/library and the smoke test show. A source's first harvest has nothing to compare with, so it is exempt.
// To accept a real change once, run the collector with --accept-changes for that source (npm run harvest -- --accept-changes <id>).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DailyRow, HarvestResult } from "../plugin";
import { isRateCurrency } from "../answer";
import { MIN_PUBLISH } from "../stats";
import { csvToRows, libraryRoot } from "./store";
import type { LibraryRow, SourceMeta } from "./store";

/** A new median above this many times the previous one, or below its reciprocal, is held back. */
export const MAX_RATIO = 3;
/** Most keys named in the recorded message; the rest are counted. */
const MAX_NAMED = 5;

export interface HeldKey {
  area: string;
  item: string;
  reason: string;
}

export interface DataCheckResult {
  /** The rows that may be published (every row when nothing was held). */
  rows: DailyRow[];
  held: HeldKey[];
  /** Set when the currency or unit changed: nothing is published for this source today. */
  unitChange: string | null;
  /** The sentence recorded in meta.json last_error, or null when the day passed every check. */
  message: string | null;
}

export const keyOf = (area: string, item: string) => `${area}\u0000${item}`;

/** The newest stored row per area and item that is older than `before`. Reads month files newest first, so it is meant for the collector. */
export function previousByKey(sourceId: string, before: string): Map<string, LibraryRow> {
  const dir = path.join(libraryRoot(), sourceId, "daily");
  const out = new Map<string, LibraryRow>();
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.csv$/.test(f)).sort().reverse();
  for (const f of files) {
    for (const r of csvToRows(readFileSync(path.join(dir, f), "utf8"))) {
      if (r.date >= before) continue;
      const k = keyOf(r.area, r.item);
      const have = out.get(k);
      if (!have || r.date > have.date) out.set(k, r);
    }
  }
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function dataCheck(opts: { result: HarvestResult; prevMeta: SourceMeta | null; previous: Map<string, LibraryRow> }): DataCheckResult {
  const { result, prevMeta, previous } = opts;
  const thick = result.rows.filter((r) => r.n >= MIN_PUBLISH);

  // a change of currency or unit: the whole day's figures mean something else, so none are published
  const was = prevMeta && previous.size > 0 ? { currency: prevMeta.currency, unit: prevMeta.unit } : null;
  if (was && ((was.currency && was.currency !== result.currency) || (was.unit && was.unit !== result.unit))) {
    const msg = `Data check: currency/unit changed from ${was.currency ?? "?"} ${was.unit ?? "?"} to ${result.currency} ${result.unit}; nothing published for ${result.date} (previous kept).`;
    return { rows: [], held: thick.map((r) => ({ area: r.area, item: r.item, reason: "currency/unit changed" })), unitChange: msg, message: msg };
  }

  const kept: DailyRow[] = [];
  const held: HeldKey[] = [];
  // An interest rate can legitimately move by a large factor from a very small base (an overnight deposit rate of 0.05 to 0.2),
  // and a published rate is passed on exactly as published, so the 3x rule does not apply to rates. The currency/unit check above still does.
  const ratio3x = !isRateCurrency(result.currency);
  for (const r of result.rows) {
    const prev = previous.get(keyOf(r.area, r.item));
    if (ratio3x && r.n >= MIN_PUBLISH && prev && prev.median > 0 && Number.isFinite(r.median) && r.median > 0) {
      const ratio = r.median / prev.median;
      if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) {
        held.push({
          area: r.area,
          item: r.item,
          reason: `median ${r.median} vs previous ${prev.median} on ${prev.date} (${round2(ratio)}x)`,
        });
        continue;
      }
    }
    kept.push(r);
  }
  if (!held.length) return { rows: kept, held, unitChange: null, message: null };
  const named = held.slice(0, MAX_NAMED).map((h) => `${h.area}/${h.item}: ${h.reason}`);
  const more = held.length > MAX_NAMED ? `; and ${held.length - MAX_NAMED} more` : "";
  const message = `Data check held back ${held.length} key${held.length === 1 ? "" : "s"} for ${result.date} (previous kept): ${named.join("; ")}${more}.`;
  return { rows: kept, held, unitChange: null, message };
}
