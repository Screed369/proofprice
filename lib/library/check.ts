// The data checker: runs in the collector (scripts/harvest.ts) before a day's aggregates are written to the price library.
// For every key (area + item) it compares the new median with the previous stored one. A median above 3x or below a third of
// the previous value, or a change of currency or unit, is more likely a broken feed than a real price move: that key is NOT
// published (the previous value stays in the library) and the reason is recorded in meta.json (last_error), which
// /api/v1/library and the smoke test show. A source's first harvest has nothing to compare with, so it is exempt.
// Spot and day-ahead power items use a band of 20x (MAX_RATIO_SPOT) because they genuinely swing that much.
// A real level shift (a new price regime) would be held forever, because the previous value never changes. So the held values are
// remembered in meta.json (held_streak): when the same new median (within 10%) has been seen on 3 distinct harvest days in a row,
// it is accepted and published, with a note in meta.json. A one-day spike is never accepted. To accept a real change at once, run the collector with --accept-changes for that source (npm run harvest -- --accept-changes <id>).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DailyRow, HarvestResult } from "../plugin";
import { passesGate } from "../stats";
import { csvToRows, libraryRoot } from "./store";
import type { LibraryRow, SourceMeta } from "./store";

/** A new median above this many times the previous one, or below its reciprocal, is held back. */
export const MAX_RATIO = 3;
/** Spot and day-ahead power prices swing several-fold between a windy Sunday and a calm weekday (DE day-ahead: 130 then 21 EUR/MWh), so those items get a wider band. A unit mix-up (MWh against kWh) is 1000x, far outside it. */
export const MAX_RATIO_SPOT = 20;
/** Items that are a wholesale spot or day-ahead power price. */
export const isSpotItem = (item: string) => item === "day-ahead" || item === "spot" || item.startsWith("spot-") || item.endsWith("/day-ahead");
/** Distinct harvest days on which the same new level must be seen before a held jump is accepted as a real shift. */
export const ACCEPT_AFTER_DAYS = 3;
/** How close (relative) two held medians must be to count as the same level. */
export const SAME_LEVEL = 0.1;
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
  /** Held medians seen so far per key (to be stored in meta.json held_streak); empty when nothing is being held. */
  heldStreak: Record<string, HeldStreak>;
  /** Keys whose held level was seen on ACCEPT_AFTER_DAYS days and is now published. */
  accepted: string[];
}

export interface HeldStreak {
  median: number;
  dates: string[];
}

const streakKey = (area: string, item: string) => `${area}::${item}`;
const sameLevel = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= SAME_LEVEL * Math.max(a, b);

/** Items that are a published rate of change (e.g. "flat:yoy", a few percent, often near zero): a ratio test means nothing for them. */
export const isRateItem = (item: string) => item.endsWith(":yoy");

/** A median that sits near zero compared with the day's own spread (p10 to p90), e.g. a spot power price that can swing through zero: a ratio against it means nothing, in either direction. */
export const isNearZero = (median: number, low: number, high: number) =>
  Number.isFinite(low) && Number.isFinite(high) && high > low && Math.abs(median) < 0.25 * (high - low);

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
  const thick = result.rows.filter((r) => passesGate(r.n));

  // a change of currency or unit: the whole day's figures mean something else, so none are published
  const was = prevMeta && previous.size > 0 ? { currency: prevMeta.currency, unit: prevMeta.unit } : null;
  if (was && ((was.currency && was.currency !== result.currency) || (was.unit && was.unit !== result.unit))) {
    const msg = `Data check: currency/unit changed from ${was.currency ?? "?"} ${was.unit ?? "?"} to ${result.currency} ${result.unit}; nothing published for ${result.date} (previous kept).`;
    return { rows: [], held: thick.map((r) => ({ area: r.area, item: r.item, reason: "currency/unit changed" })), unitChange: msg, message: msg, heldStreak: {}, accepted: [] };
  }

  const kept: DailyRow[] = [];
  const held: HeldKey[] = [];
  const heldStreak: Record<string, HeldStreak> = {};
  const accepted: string[] = [];
  const before = prevMeta?.held_streak ?? {};
  for (const r of result.rows) {
    const prev = previous.get(keyOf(r.area, r.item));
    if (!isRateItem(r.item) && passesGate(r.n) && prev && prev.median > 0 && Number.isFinite(r.median) && r.median > 0 &&
      !isNearZero(prev.median, prev.low, prev.high) && !isNearZero(r.median, r.low, r.high)) {
      const ratio = r.median / prev.median;
      const limit = isSpotItem(r.item) ? MAX_RATIO_SPOT : MAX_RATIO;
      if (ratio > limit || ratio < 1 / limit) {
        const sk = streakKey(r.area, r.item);
        const old = before[sk];
        const dates = old && sameLevel(old.median, r.median) ? [...old.dates.filter((d) => d !== result.date), result.date] : [result.date];
        if (dates.length >= ACCEPT_AFTER_DAYS) {
          accepted.push(`${r.area}/${r.item}: median ${r.median} accepted after ${dates.length} days at this level (${dates[0]} to ${result.date}); was ${prev.median} on ${prev.date}`);
          kept.push(r);
          continue;
        }
        heldStreak[sk] = { median: r.median, dates };
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
  if (!held.length) return { rows: kept, held, unitChange: null, message: null, heldStreak, accepted };
  const named = held.slice(0, MAX_NAMED).map((h) => `${h.area}/${h.item}: ${h.reason}`);
  const more = held.length > MAX_NAMED ? `; and ${held.length - MAX_NAMED} more` : "";
  const message = `Data check held back ${held.length} key${held.length === 1 ? "" : "s"} for ${result.date} (previous kept): ${named.join("; ")}${more}.`;
  return { rows: kept, held, unitChange: null, message, heldStreak, accepted };
}
