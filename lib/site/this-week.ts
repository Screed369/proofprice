// Data for the /this-week page: "What people paid this week". Built from the price library only (daily aggregates, never one record).
// For each library source in fuel, energy and home sales, the newest day is compared with the day about a week earlier, for
// the whole-country figure of a small list of well-understood items. Every move carries its kind (real sale, official statistic or
// posted price), both dates, both sample sizes, the source and the licence. Nothing is typed in here except the rules for which
// items are compared.

import { fmtMoney } from "../answer";
import { readMeta, readRowsOnDates, libraryDates, type LibraryRow } from "../library/store";
import type { SourceInfo } from "../plugin";
import { PRICE_TYPE_SHORT } from "../price-types";
import { SOURCE_PLUGINS } from "../registry";
import { MIN_PUBLISH } from "../stats";
import { countryName } from "./areas";
import { daysBetween } from "./format";
import { FUEL_PHRASE } from "./page-wording";

export interface MoveGroupSpec {
  id: "fuel" | "energy" | "homes";
  title: string;
  /** Registry category ids that belong to this group. */
  categories: string[];
  intro: string;
}

export const MOVE_GROUPS: MoveGroupSpec[] = [
  { id: "fuel", title: "Fuel", categories: ["fuel"], intro: "Posted pump prices: what stations display, not receipts." },
  { id: "energy", title: "Energy", categories: ["energy"], intro: "Electricity and gas prices as published by the energy regulator or statistics office." },
  { id: "homes", title: "Homes", categories: ["home-sales"], intro: "Recorded sale prices of homes. Asking prices are never used." },
];

/** Smallest and largest gap, in days, between the two days compared. About a week is wanted. */
export const MIN_GAP_DAYS = 5;
export const MAX_GAP_DAYS = 35;
export const WANT_GAP_DAYS = 7;
/** A source whose newest day is further behind the freshest source than this is left out as stale. */
export const MAX_BEHIND_DAYS = 21;
export const MAX_PER_GROUP = 6;
export const MAX_PER_SOURCE = 2;

/** Plain name of an item, or null when we do not compare it (unknown items are never guessed at). */
export function itemLabel(group: MoveGroupSpec["id"], item: string): string | null {
  if (group === "fuel") return FUEL_PHRASE[item] ? FUEL_PHRASE[item] : null;
  if (group === "energy") return item === "electricity" ? "electricity" : null;
  if (group === "homes") return item === "any:12m" ? "homes sold in the last 12 months (median)" : null;
  return null;
}

/** Whole-country rows only: area "ALL". */
function isNational(area: string): boolean {
  return area === "ALL";
}

/** The day to compare with: gap between MIN and MAX days before `latest`, the one closest to a week (the later one on a tie). */
export function pickBaseline(dates: string[], latest: string): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const d of dates) {
    const gap = daysBetween(d, latest);
    if (gap === null || gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) continue;
    const score = Math.abs(gap - WANT_GAP_DAYS);
    if (score < bestScore || (score === bestScore && best !== null && d > best)) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** The licence name in a few words: the text before the first bracket, full stop or "under"; at most 60 characters. */
export function shortLicence(licence: string): string {
  const cut = licence.split(/\s\(|\.\s|\sunder\s|;\s/)[0].trim();
  return cut.length > 60 ? `${cut.slice(0, 57).trimEnd()}...` : cut;
}

/** Fuel units mention compressed gas per kg for the sources that carry it; the items compared here are all litres. */
export function cleanUnit(group: MoveGroupSpec["id"], unit: string): string {
  return group === "fuel" ? unit.replace(/\s*\(CNG per kg\)/, "") : unit;
}

export function kindLabel(t: SourceInfo["price_type"]): string {
  if (t === "transaction") return "Real sale";
  if (t === "official_statistic") return "Official statistic";
  if (t === "posted_pump_price" || t === "posted_price") return "Posted price";
  return PRICE_TYPE_SHORT[t];
}

export interface Move {
  group: MoveGroupSpec["id"];
  sourceId: string;
  sourceName: string;
  publisher: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  kind: string;
  /** False for official statistics: the sample size of a published average is not a count of records we hold. */
  countsRecords: boolean;
  /** Licence name in a few words (the full text is on /sources); the link is licenceUrl. */
  licenceShort: string;
  placeName: string;
  itemName: string;
  currency: string;
  unit: string;
  baseDate: string;
  latestDate: string;
  baseMedian: number;
  latestMedian: number;
  baseN: number;
  latestN: number;
  /** Percentage change, rounded to one decimal. */
  pct: number;
}

export interface MoveInput {
  group: MoveGroupSpec["id"];
  info: SourceInfo;
  country: string;
  currency: string;
  unit: string;
  baseDate: string;
  latestDate: string;
  baseRows: LibraryRow[];
  latestRows: LibraryRow[];
}

/** Pure: the moves of one source between two days. Thin rows (under MIN_PUBLISH records) and unknown items are skipped. */
export function movesOf(i: MoveInput): Move[] {
  const base = new Map<string, LibraryRow>();
  for (const r of i.baseRows) if (r.date === i.baseDate && isNational(r.area)) base.set(r.item, r);
  const out: Move[] = [];
  for (const r of i.latestRows) {
    if (r.date !== i.latestDate || !isNational(r.area)) continue;
    const name = itemLabel(i.group, r.item);
    const b = base.get(r.item);
    if (!name || !b) continue;
    if (!(r.n >= MIN_PUBLISH) || !(b.n >= MIN_PUBLISH)) continue;
    if (!(b.median > 0) || !(r.median > 0)) continue;
    const pct = Math.round(((r.median - b.median) / b.median) * 1000) / 10;
    if (pct === 0) continue;
    out.push({
      group: i.group,
      sourceId: i.info.id,
      sourceName: i.info.name,
      publisher: i.info.publisher,
      licence: i.info.licence,
      licenceUrl: i.info.licence_url,
      attribution: i.info.attribution,
      kind: kindLabel(i.info.price_type),
      countsRecords: i.info.price_type !== "official_statistic",
      licenceShort: shortLicence(i.info.licence),
      placeName: countryName(i.country),
      itemName: name,
      currency: i.currency,
      unit: cleanUnit(i.group, i.unit),
      baseDate: i.baseDate,
      latestDate: i.latestDate,
      baseMedian: b.median,
      latestMedian: r.median,
      baseN: b.n,
      latestN: r.n,
      pct,
    });
  }
  return out;
}

/** Pure: keep the biggest moves of a group (by size, at most MAX_PER_SOURCE from one source), biggest first. */
export function topMoves(all: Move[], limit = MAX_PER_GROUP): Move[] {
  const sorted = [...all].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.sourceId.localeCompare(b.sourceId) || a.itemName.localeCompare(b.itemName));
  const perSource = new Map<string, number>();
  const out: Move[] = [];
  for (const m of sorted) {
    const used = perSource.get(m.sourceId) ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    perSource.set(m.sourceId, used + 1);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export interface ThisWeek {
  groups: { spec: MoveGroupSpec; moves: Move[]; sourcesCompared: number }[];
  /** Newest library day behind any figure on the page, or null if there is none. */
  asOf: string | null;
}

let cache: ThisWeek | null = null;

/** Reads the library. Memoised: the library cannot change inside one build. */
export function loadThisWeek(): ThisWeek {
  if (cache) return cache;
  const candidates: { group: MoveGroupSpec["id"]; plugin: (typeof SOURCE_PLUGINS)[number]; dates: string[] }[] = [];
  for (const plugin of SOURCE_PLUGINS) {
    const group = MOVE_GROUPS.find((g) => g.categories.includes(plugin.category));
    if (!group) continue;
    const dates = libraryDates(plugin.info.id);
    if (dates.length) candidates.push({ group: group.id, plugin, dates });
  }
  const freshest = candidates.reduce((a, c) => (c.dates[c.dates.length - 1] > a ? c.dates[c.dates.length - 1] : a), "");
  const moves: Record<string, Move[]> = { fuel: [], energy: [], homes: [] };
  const compared: Record<string, number> = { fuel: 0, energy: 0, homes: 0 };
  for (const c of candidates) {
    const latestDate = c.dates[c.dates.length - 1];
    const behind = daysBetween(latestDate, freshest);
    if (behind === null || behind > MAX_BEHIND_DAYS) continue;
    const baseDate = pickBaseline(c.dates, latestDate);
    if (!baseDate) continue;
    const meta = readMeta(c.plugin.info.id);
    const rows = readRowsOnDates(c.plugin.info.id, [baseDate, latestDate]);
    const country = c.plugin.countries[0] ?? "";
    const found = movesOf({
      group: c.group,
      info: c.plugin.info,
      country,
      currency: meta?.currency ?? "",
      unit: meta?.unit ?? "",
      baseDate,
      latestDate,
      baseRows: rows.filter((r) => r.date === baseDate),
      latestRows: rows.filter((r) => r.date === latestDate),
    });
    compared[c.group] += 1;
    moves[c.group].push(...found);
  }
  const groups = MOVE_GROUPS.map((spec) => ({ spec, moves: topMoves(moves[spec.id]), sourcesCompared: compared[spec.id] }));
  const asOf = groups.flatMap((g) => g.moves.map((m) => m.latestDate)).sort().pop() ?? null;
  cache = { groups, asOf };
  return cache;
}

/** "EUR 1.52" style price for a move, with the currency the library holds. */
export function priceText(v: number, currency: string): string {
  return currency ? fmtMoney(v, currency) : String(v);
}
