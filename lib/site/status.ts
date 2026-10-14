// Health of the price library, per source, for /status. Pure: the caller passes the cards and the clock.

import { daysBetween } from "./format";
import type { SourceCard } from "./sources";

/** A collection older than this many days is marked late (the collector runs once a day). */
export const LATE_AFTER_DAYS = 2;

export type LibraryHealth = "ok" | "late" | "error" | "no-data";

export interface LibraryStatusRow {
  id: string;
  name: string;
  countryNames: string[];
  health: LibraryHealth;
  lastDate: string | null; // newest day of figures held
  daysCollected: number;
  lastHarvestAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  ageDays: number | null; // days since the last successful collection, at `now`
  note: string | null;
}

export function libraryHealth(card: SourceCard, now: Date): LibraryStatusRow {
  const m = card.library;
  const ageDays = m?.last_ok_at ? daysBetween(m.last_ok_at, now.toISOString()) : null;
  let health: LibraryHealth = "ok";
  if (!m) health = "no-data";
  else if (m.last_error) health = "error";
  else if (ageDays === null || ageDays > LATE_AFTER_DAYS) health = "late";
  return {
    id: card.id,
    name: card.name,
    countryNames: card.countryNames,
    health,
    lastDate: m?.last_date ?? null,
    daysCollected: m?.days ?? 0,
    lastHarvestAt: m?.last_harvest_at ?? null,
    lastOkAt: m?.last_ok_at ?? null,
    lastError: m?.last_error ?? null,
    ageDays,
    note: m?.note ?? null,
  };
}

export function libraryStatusRows(cards: SourceCard[], now: Date): LibraryStatusRow[] {
  return cards.filter((c) => c.collected).map((c) => libraryHealth(c, now));
}

export const HEALTH_LABEL: Record<LibraryHealth, string> = {
  ok: "OK",
  late: "Late",
  error: "Error",
  "no-data": "No data yet",
};
