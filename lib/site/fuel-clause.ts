// Contract-ready fuel clause pages (/fuel-clause/<country>): the weekly official diesel figure for a country, kept as a permanent record
// that a contract can point to, with source, licence, attribution, the date range and a SHA-256 content hash of the figures shown.
// Built from the price library at build time (static pages). Aggregates only; official statistics only; nothing here is an asking price.
//
// Series: the EU Weekly Oil Bulletin national average diesel price WITH all duties and taxes (24 Member States the bulletin source answers
// for, plus ES, FR and IT, whose own station-level sources are separate) and the UK DESNZ weekly road fuel price (named exactly as the
// source's INFO names it on the page). A new series is one more entry in clauseSeries().

import { createHash } from "node:crypto";
import { readMonthly } from "../library/backfill";
import { libraryDates, readCrossCheck, readMeta, readRowsOnDates, type CrossCheckRow } from "../library/store";
import { SOURCE_PLUGINS } from "../registry";
import type { SourceInfo } from "../plugin";
import { COUNTRIES as WOB_COUNTRIES, STAND_IN as WOB_STAND_IN } from "../../sources/eu-oil-bulletin/source";
import { countryName } from "./areas";

export interface ClauseSeries {
  /** URL slug, lower-case country code: /fuel-clause/ie */
  slug: string;
  code: string;
  name: string;
  /** Library source and the area and item inside it. */
  sourceId: string;
  area: string;
  item: string;
  /** What the figure includes, in one plain sentence. */
  basis: string;
  /** Library sources whose own outside check compares a ProofPrice figure with this publisher's headline figure (key = their_key). */
  outsideCheck?: { sourceId: string; theirKey: string; what: string };
}

const WOB_BASIS = "National average pump price of automotive gas oil (diesel) with all duties and taxes included (VAT and excise), euro per litre, prices in force on the Monday of each bulletin week.";
const OUTSIDE: Record<string, { sourceId: string; what: string }> = {
  FR: { sourceId: "fr-fuel", what: "ProofPrice's own station-level diesel figure for France" },
  ES: { sourceId: "es-fuel", what: "ProofPrice's own station-level diesel figure for Spain" },
  NL: { sourceId: "nl-cbs-fuel", what: "ProofPrice's own Statistics Netherlands diesel figure" },
};

export function clauseSeries(): ClauseSeries[] {
  const wob = [...Object.keys(WOB_COUNTRIES), ...Object.keys(WOB_STAND_IN)].map((code): ClauseSeries => ({
    slug: code.toLowerCase(),
    code,
    name: countryName(code),
    sourceId: "eu-oil-bulletin",
    area: code,
    item: "diesel",
    basis: WOB_BASIS,
    ...(OUTSIDE[code] ? { outsideCheck: { sourceId: OUTSIDE[code].sourceId, theirKey: `${code}/diesel`, what: OUTSIDE[code].what } } : {}),
  }));
  const gb: ClauseSeries = {
    slug: "gb",
    code: "GB",
    name: "Great Britain",
    sourceId: "gb-desnz-fuel",
    area: "ALL",
    item: "diesel",
    basis: "Weekly average pump price of diesel with duty and VAT included, pence converted to pounds per litre, as published by the UK government (DESNZ).",
  };
  return [...wob.sort((a, b) => a.name.localeCompare(b.name, "en")), gb];
}

export const MAX_WEEKS = 104;
export const MONTHS_SHOWN = 24;

export interface WeekFigure {
  date: string; // the Monday the price was in force (YYYY-MM-DD)
  value: number;
}
export interface MonthFigure {
  month: string; // YYYY-MM
  mean: number;
  low: number;
  high: number;
}

export interface OutsideCheckLine {
  checkedAt: string;
  what: string;
  theirPeriod: string;
  verdict: CrossCheckRow["verdict"];
  gapPct: number;
}

export interface ClausePage {
  series: ClauseSeries;
  info: SourceInfo;
  currency: string;
  unit: string;
  /** Newest first. */
  weeks: WeekFigure[];
  /** Newest first. */
  months: MonthFigure[];
  from: string | null;
  to: string | null;
  /** The exact text that is hashed (see canonicalText) and its SHA-256, lower-case hex. */
  canonical: string;
  hash: string;
  /** Number of weeks for which the library holds two different values (a later bulletin revised an earlier week). 0 normally. */
  revisedWeeks: number;
  outside: OutsideCheckLine | null;
  /** The newest data day in the library for this source. */
  libraryDay: string | null;
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** Pure: weekly figures from library rows. A row "diesel" on date D is the bulletin of D; "diesel@E" on any date is the value in the bulletin of E.
 *  The row stored under its own date wins; a disagreeing later restatement is counted in `revised`. Newest first. */
export function weeklyFromRows(rows: { date: string; area: string; item: string; median: number }[], area: string, item: string): { weeks: WeekFigure[]; revised: number } {
  const own = new Map<string, number>();
  const restated = new Map<string, number>();
  for (const r of rows) {
    if (r.area !== area || !Number.isFinite(r.median) || r.median <= 0) continue;
    if (r.item === item) own.set(r.date, r.median);
    else if (r.item.startsWith(`${item}@`)) {
      const d = r.item.slice(item.length + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !restated.has(d)) restated.set(d, r.median);
    }
  }
  const all = new Map<string, number>(restated);
  let revised = 0;
  for (const [d, v] of own) {
    const other = restated.get(d);
    if (other !== undefined && Math.abs(other - v) > 1e-9) revised++;
    all.set(d, v);
  }
  const weeks = [...all.entries()].map(([date, value]) => ({ date, value: r5(value) })).sort((a, b) => b.date.localeCompare(a.date));
  return { weeks: weeks.slice(0, MAX_WEEKS), revised };
}

/** The exact text the content hash covers. One header line naming the series, then one line per figure, oldest first, tab separated, "\n" ends each line. */
export function canonicalText(s: { sourceId: string; area: string; item: string; currency: string; unit: string }, weeks: WeekFigure[], months: MonthFigure[]): string {
  const head = `proofprice fuel clause | source=${s.sourceId} | area=${s.area} | item=${s.item} | currency=${s.currency} | unit=${s.unit}\n`;
  const w = [...weeks].sort((a, b) => a.date.localeCompare(b.date)).map((x) => `week\t${x.date}\t${x.value.toFixed(5)}\n`).join("");
  const m = [...months].sort((a, b) => a.month.localeCompare(b.month)).map((x) => `month\t${x.month}\t${x.mean.toFixed(5)}\t${x.low.toFixed(5)}\t${x.high.toFixed(5)}\n`).join("");
  return head + w + m;
}

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function monthsFor(s: ClauseSeries, to: string): MonthFigure[] {
  const y = Number(to.slice(0, 4));
  const from = `${y - 3}-01`;
  const rows = readMonthly(s.sourceId, { area: s.area, item: s.item, from, to: `${to.slice(0, 7)}` });
  return rows
    .filter((r) => Number.isFinite(r.median) && r.median > 0)
    .map((r) => ({ month: r.date, mean: r5(r.median), low: r5(r.low), high: r5(r.high) }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, MONTHS_SHOWN);
}

function outsideLine(s: ClauseSeries): OutsideCheckLine | null {
  if (!s.outsideCheck) return null;
  const rows = readCrossCheck(s.outsideCheck.sourceId).filter((r) => r.their_key === s.outsideCheck!.theirKey);
  const last = rows.sort((a, b) => a.their_period.localeCompare(b.their_period) || a.checked_at.localeCompare(b.checked_at)).pop();
  return last ? { checkedAt: last.checked_at, what: s.outsideCheck.what, theirPeriod: last.their_period, verdict: last.verdict, gapPct: last.gap_pct } : null;
}

const ROWS = new Map<string, ReturnType<typeof readRowsOnDates>>(); // one read per source per build

/** Build one page from the price library. Null when the library holds no weekly figure for the series (no page is made then). */
export function loadClausePage(slug: string): ClausePage | null {
  const hit = PAGES.get(slug);
  if (hit !== undefined) return hit;
  const built = buildClausePage(slug);
  PAGES.set(slug, built);
  return built;
}

const PAGES = new Map<string, ClausePage | null>(); // pages are built once per process (static build)

/** Tests clear the caches after pointing PROOFPRICE_LIBRARY_DIR at a fixture library. */
export function resetClauseCache(): void {
  PAGES.clear();
  ROWS.clear();
}

function buildClausePage(slug: string): ClausePage | null {
  const series = clauseSeries().find((s) => s.slug === slug);
  if (!series) return null;
  const plugin = SOURCE_PLUGINS.find((p) => p.info.id === series.sourceId);
  if (!plugin) return null;
  const dates = libraryDates(series.sourceId);
  if (!dates.length) return null;
  let rows = ROWS.get(series.sourceId);
  if (!rows) ROWS.set(series.sourceId, (rows = readRowsOnDates(series.sourceId, dates)));
  const { weeks, revised } = weeklyFromRows(rows, series.area, series.item);
  if (!weeks.length) return null;
  const meta = readMeta(series.sourceId);
  const currency = meta?.currency ?? "EUR";
  const unit = meta?.unit ?? "per litre";
  const to = weeks[0].date;
  const months = monthsFor(series, to);
  const canonical = canonicalText({ ...series, currency, unit }, weeks, months);
  return {
    series,
    info: plugin.info,
    currency,
    unit,
    weeks,
    months,
    from: weeks[weeks.length - 1].date,
    to,
    canonical,
    hash: sha256(canonical),
    revisedWeeks: revised,
    outside: outsideLine(series),
    libraryDay: dates[dates.length - 1],
  };
}

/** Slugs that have a page (the library holds at least one weekly figure). */
export function clauseSlugs(): string[] {
  return clauseSeries().filter((s) => loadClausePage(s.slug)).map((s) => s.slug);
}

export const CLAUSE_PATH = "/fuel-clause";
export const clausePath = (slug: string) => `${CLAUSE_PATH}/${slug}`;
/** The paths for the sitemap. */
export function clausePaths(): string[] {
  const slugs = clauseSlugs();
  return slugs.length ? [CLAUSE_PATH, ...slugs.map(clausePath)] : [];
}
