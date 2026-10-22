// The outside check ("crossCheck"): every release, put our figure next to the publisher's own headline figure for the same place
// and flag the ones that do not fit. A tripwire, not a judge (Simon, 22 Oct 2026): it catches wrong units, a shifted column, stale
// data, the wrong area, a half-empty feed; it cannot tell us the publisher is wrong.
//
// Three verdicts per area and release:
//   AGREES     the gap is within tolerancePct of zero (and has not jumped)          -> silent
//   EXPLAINED  the gap is larger, but inside the bias the source declared in advance  -> silent
//   SUSPECT    the gap is outside the declared bias by more than tolerancePct, OR it jumped by more than jumpPoints from its usual
//              level, OR (compareVolumes) our count is off theirs, OR (library) today's records fell below minCountShare of the
//              7-day median                                                          -> the Quality Auditor reads it
// The alarm is a JUMP in the gap, not the gap itself: a steady, explained gap is normal (fuel: we count stations once, the Oil
// Bulletin weights by volume sold).
//
// Internal only. This file is used by scripts/crosscheck.ts (GitHub Actions) and by the registry gate; no route imports it.

import type { CrossCheck, CrossCheckArea, CrossCheckContext, CrossCheckHeadline, CrossCheckOurs, SourcePlugin } from "./plugin";
import type { PriceAnswer } from "./answer";
import type { CrossCheckMeta, CrossCheckRow, LibraryRow } from "./library/store";
import { hasCount, MIN_PUBLISH } from "./stats";

export const DEFAULT_JUMP_POINTS = 1.5;
export const DEFAULT_MIN_COUNT_SHARE = 0.8;
/** How many earlier releases make the "usual gap". */
export const BASELINE_RELEASES = 4;
/** The workflow fails (one email to Simon) when a source's publisher file could not be read this many runs in a row. */
export const FAIL_AFTER_RUNS = 3;
export const CROSSCHECK_USER_AGENT = "ProofPrice-crosscheck/1.0 (+https://proofprice.com; hello@proofprice.com)";

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function biasBand(cc: Pick<CrossCheck, "expectedBiasPct">): [number, number] {
  const b = cc.expectedBiasPct ?? 0;
  return Array.isArray(b) ? [b[0], b[1]] : [b, b];
}

export function gapPct(ours: number, theirs: number): number {
  return round(((ours - theirs) / theirs) * 100);
}

/** How far x sits outside [lo, hi] (0 inside). */
const outside = (x: number, [lo, hi]: [number, number]) => (x < lo ? lo - x : x > hi ? x - hi : 0);

export interface VerdictInput {
  gap: number;
  band: [number, number];
  tolerancePct: number;
  /** Gaps of earlier releases for the same area, newest last. */
  previousGaps: number[];
  jumpPoints: number;
  volume?: { ratio: number; expectedRatio: [number, number]; tolerancePct: number };
  /** ours "library": today's records / the 7-day median (undefined when the source gives no counts). */
  countShare?: { share: number; min: number };
}

/** The verdict for one comparison, with the reasons in plain words. Pure. */
export function judge(v: VerdictInput): { verdict: CrossCheckRow["verdict"]; reason: string } {
  const reasons: string[] = [];
  const off = outside(v.gap, v.band);
  if (off > v.tolerancePct) {
    reasons.push(`gap ${v.gap}% is outside the expected ${fmtBand(v.band)} by more than ${v.tolerancePct} points`);
  }
  const prev = v.previousGaps.slice(-BASELINE_RELEASES);
  if (prev.length) {
    const usual = round(median(prev));
    if (Math.abs(v.gap - usual) > v.jumpPoints) reasons.push(`gap jumped from its usual ${usual}% to ${v.gap}% (more than ${v.jumpPoints} points)`);
  }
  if (v.volume) {
    const vr = v.volume.ratio;
    const [lo, hi] = v.volume.expectedRatio;
    const tol = v.volume.tolerancePct / 100;
    if (vr < lo * (1 - tol) || vr > hi * (1 + tol)) {
      reasons.push(`our count is ${round(vr, 2)}x theirs (expected ${lo === hi ? `${lo}x` : `${lo}-${hi}x`} within ${v.volume.tolerancePct}%): the area or the filter may differ`);
    }
  }
  if (v.countShare && v.countShare.share < v.countShare.min) {
    reasons.push(`inside count: today's records are ${Math.round(v.countShare.share * 100)}% of the 7-day median (below ${Math.round(v.countShare.min * 100)}%), the feed may be half empty`);
  }
  if (reasons.length) return { verdict: "SUSPECT", reason: reasons.join("; ") };
  if (Math.abs(v.gap) <= v.tolerancePct) return { verdict: "AGREES", reason: "" };
  return { verdict: "EXPLAINED", reason: `gap ${v.gap}% is inside the declared bias ${fmtBand(v.band)}` };
}

function fmtBand([lo, hi]: [number, number]): string {
  const f = (x: number) => `${x > 0 ? "+" : ""}${x}%`;
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`;
}

// ---------- our side ----------

/** Months between two YYYY-MM-DD dates (inclusive of both ends), at least 1/30. */
export function spanMonths(from: string, to: string): number {
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000 + 1;
  return Math.max(days, 1) / (365.25 / 12);
}

/** Default reading of our answer: the headline value, the sample size, the publisher's reference period or our period. */
export function defaultOurFigure(a: PriceAnswer): CrossCheckOurs | null {
  if (a.status !== "ok" || !a.price) return null;
  const period = a.statistic?.reference_period ?? (a.period.from && a.period.to ? (a.period.from === a.period.to ? a.period.to : `${a.period.from}..${a.period.to}`) : a.as_of.slice(0, 10));
  return { value: a.price.value, period, n: a.sample_size };
}

/** Our national roll-up of one item on one day of the library: the record-weighted mean of the area medians (the "ALL" row is left
 *  out when areas are present; a source with only a national row gives that row). n = records summed over the areas. */
export function libraryRollup(rows: LibraryRow[], item: string, date: string): CrossCheckOurs | null {
  const day = rows.filter((r) => r.item === item && r.date === date);
  const areas = day.filter((r) => r.area !== "ALL" && hasCount(r.n) && r.n > 0);
  if (areas.length) {
    const n = areas.reduce((s, r) => s + r.n, 0);
    const value = areas.reduce((s, r) => s + r.median * r.n, 0) / n;
    return { value: round(value, 4), period: date, n };
  }
  const single = day.filter((r) => !hasCount(r.n) || r.n > 0);
  if (single.length === 1) return { value: single[0].median, period: date, n: hasCount(single[0].n) ? single[0].n : null };
  return null;
}

/** The library day to compare with the publisher's date: the same day, else the day before (a Monday bulletin against a Sunday
 *  snapshot is still like for like for fuel); never a later day. */
export function pickLibraryDate(dates: string[], theirDate: string): string | null {
  if (dates.includes(theirDate)) return theirDate;
  const dayBefore = new Date(Date.parse(theirDate + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  return dates.includes(dayBefore) ? dayBefore : null;
}

/** Today's records for an item against the median of the 7 library days before. Undefined when there are no counts. */
export function countShareFor(rows: LibraryRow[], item: string, date: string, dates: string[]): number | undefined {
  const total = (d: string) => rows.filter((r) => r.item === item && r.date === d && r.area !== "ALL" && hasCount(r.n)).reduce((s, r) => s + r.n, 0);
  const today = total(date);
  const before = dates.filter((d) => d < date).slice(-7).map(total).filter((x) => x > 0);
  if (!today || !before.length) return undefined;
  return round(today / median(before), 3);
}

// ---------- one source ----------

export interface SourceRunDeps {
  ctx: CrossCheckContext;
  /** ours "api": the answer of proofprice.com (the runner asks with ppcheck=1). */
  askApi(source: SourcePlugin, query: Record<string, string>): Promise<PriceAnswer>;
  /** ours "library": every library row of the source in the month(s) around a date, and the dates held. */
  library(sourceId: string): { rows: LibraryRow[]; dates: string[] };
  /** Earlier rows of this source (for the jump check). */
  previous: CrossCheckRow[];
  today: string;
}

export interface SourceRunResult {
  rows: CrossCheckRow[];
  /** The publisher's file could not be read (link moved, outage). */
  fetchError: string | null;
  notes: string[];
}

export async function runSourceCheck(source: SourcePlugin, deps: SourceRunDeps): Promise<SourceRunResult> {
  const cc = source.crossCheck!;
  const notes: string[] = [];
  let headlines: CrossCheckHeadline[];
  try {
    headlines = await cc.fetch(deps.ctx);
  } catch (e: any) {
    return { rows: [], fetchError: `link moved or unreachable: ${String(e?.message ?? e).slice(0, 240)}`, notes };
  }
  const byKey = new Map(headlines.map((h) => [h.key, h]));
  const band = biasBand(cc);
  const rows: CrossCheckRow[] = [];
  const lib = cc.ours === "library" ? deps.library(source.info.id) : null;
  for (const area of cc.areas) {
    const theirs = byKey.get(area.theirs);
    if (!theirs) {
      notes.push(`${area.label}: the publisher's file has no figure for ${area.theirs}`);
      continue;
    }
    if (theirs.n !== undefined && theirs.n !== null && theirs.n < MIN_PUBLISH) {
      notes.push(`${area.label}: their figure rests on fewer than ${MIN_PUBLISH} records; not compared`);
      continue;
    }
    let ours: CrossCheckOurs | null = null;
    let countShare: number | undefined;
    try {
      if (lib) {
        const date = pickLibraryDate(lib.dates, theirs.period);
        if (!date) {
          notes.push(`${area.label}: our library holds no day for ${theirs.period}`);
          continue;
        }
        ours = libraryRollup(lib.rows, area.ours.item, date);
        countShare = countShareFor(lib.rows, area.ours.item, date, lib.dates);
      } else {
        const answer = await deps.askApi(source, area.ours);
        ours = (cc.ourFigure ?? defaultOurFigure)(answer);
      }
    } catch (e: any) {
      notes.push(`${area.label}: our figure could not be read (${String(e?.message ?? e).slice(0, 160)})`);
      continue;
    }
    if (!ours) {
      notes.push(`${area.label}: we gave no figure`);
      continue;
    }
    if (ours.n !== undefined && ours.n !== null && ours.n < MIN_PUBLISH) {
      notes.push(`${area.label}: our figure rests on fewer than ${MIN_PUBLISH} records; not compared`);
      continue;
    }
    if (cc.samePeriod && ours.period.slice(0, theirs.period.length) !== theirs.period) {
      notes.push(`${area.label}: periods differ (ours ${ours.period}, theirs ${theirs.period}); compared when both hold the same release`);
      continue;
    }
    const gap = gapPct(ours.value, theirs.value);
    const previousGaps = deps.previous.filter((r) => r.their_key === area.theirs && r.their_period !== theirs.period).map((r) => r.gap_pct);
    const volume =
      cc.compareVolumes && ours.n && theirs.n
        ? { ratio: ours.n / theirs.n, expectedRatio: cc.compareVolumes.expectedRatio ?? ([1, 1] as [number, number]), tolerancePct: cc.compareVolumes.tolerancePct }
        : undefined;
    const { verdict, reason } = judge({
      gap,
      band,
      tolerancePct: cc.tolerancePct,
      previousGaps,
      jumpPoints: cc.jumpPoints ?? DEFAULT_JUMP_POINTS,
      volume,
      countShare: countShare !== undefined ? { share: countShare, min: cc.minCountShare ?? DEFAULT_MIN_COUNT_SHARE } : undefined,
    });
    rows.push({
      checked_at: deps.today,
      area: area.label,
      their_key: area.theirs,
      their_period: theirs.period,
      their_value: theirs.value,
      our_period: ours.period,
      our_value: ours.value,
      gap_pct: gap,
      our_n: ours.n ?? null,
      their_n: theirs.n ?? null,
      verdict,
      reason: verdict === "SUSPECT" ? `${reason}. Known differences: ${cc.knownDifferences.join(" ")}` : reason,
    });
  }
  return { rows, fetchError: null, notes };
}

/** The meta entry after a run, and whether this run should fail the workflow (only when the failures in a row reach FAIL_AFTER_RUNS,
 *  so one broken link sends one email, not one a week). */
export function nextMeta(prev: CrossCheckMeta | undefined, sourceId: string, nowIso: string, r: SourceRunResult, written: number): { meta: CrossCheckMeta; failRun: boolean } {
  const failures = r.fetchError ? (prev?.consecutive_failures ?? 0) + 1 : 0;
  const compared = !r.fetchError && r.rows.length > 0;
  return {
    meta: {
      source: sourceId,
      last_run_at: nowIso,
      last_ok_at: r.fetchError ? prev?.last_ok_at ?? null : nowIso,
      last_error: r.fetchError ?? (compared || written ? null : r.notes[0] ?? "nothing compared"),
      consecutive_failures: failures,
      last_rows_written: written,
      notes: r.notes.slice(0, 10),
    },
    failRun: failures === FAIL_AFTER_RUNS,
  };
}

// ---------- the registry gate ----------

const STATISTICS = ["mean", "median", "weighted mean", "average"];
const MEASURES = ["median", "mean", "n-weighted mean of area medians", "published average"];

/** Every way a crossCheck can be malformed, as messages that say what to fix. Empty = all good. */
export function crossCheckProblems(all: SourcePlugin[], knownParams: (s: SourcePlugin) => Set<string>): string[] {
  const out: string[] = [];
  for (const s of all) {
    const cc = s.crossCheck as (CrossCheck & Record<string, unknown>) | undefined;
    if (!cc) continue;
    const where = `sources/${s.info.id}: crossCheck`;
    const bad = (m: string) => out.push(`${where}.${m}`);
    for (const k of ["headlineUrl", "releasePage"] as const) {
      const u = cc[k];
      if (typeof u !== "string" || !/^https:\/\/[^/]+\//.test(u)) bad(`${k} must be the publisher's official https link (the raw release, never news)`);
      else if (/(^|\.)proofprice\.com\//i.test(u.replace(/^https:\/\//, ""))) bad(`${k} points at proofprice.com: an outside check must read the publisher, not us`);
    }
    if (typeof cc.publisher !== "string" || cc.publisher.trim().length < 3) bad("publisher is missing");
    if (!STATISTICS.includes(cc.statistic)) bad(`statistic must be one of ${STATISTICS.join(", ")} (what THEY publish)`);
    if (!MEASURES.includes(cc.ourMeasure)) bad(`ourMeasure must be one of ${MEASURES.join(", ")}`);
    if (typeof cc.series !== "string" || cc.series.trim().length < 15) bad('series must name the EXACT official series, e.g. "CSO HPM07, moving 12-month median, Existing, Filings"');
    if (cc.cadence !== "weekly" && cc.cadence !== "monthly") bad('cadence must be "weekly" or "monthly"');
    if (cc.ours !== "api" && cc.ours !== "library") bad('ours must be "api" (live answer, ppcheck=1) or "library" (our daily roll-up)');
    if (cc.ours === "library" && !s.harvest) bad('ours is "library" but this source has no harvest(): use ours "api"');
    if (typeof cc.fetch !== "function") bad("fetch(ctx) is missing: read the publisher's file with ctx.get and a pure parser");
    if (cc.ourFigure !== undefined && typeof cc.ourFigure !== "function") bad("ourFigure must be a function");
    if (typeof cc.tolerancePct !== "number" || !(cc.tolerancePct > 0) || cc.tolerancePct > 25) bad("tolerancePct must be a number above 0 and at most 25");
    const b = cc.expectedBiasPct;
    if (b !== undefined) {
      const ok = typeof b === "number" ? Number.isFinite(b) && Math.abs(b) <= 25 : Array.isArray(b) && b.length === 2 && b.every((x) => typeof x === "number" && Math.abs(x) <= 25) && b[0] <= b[1];
      if (!ok) bad("expectedBiasPct must be a number or a [low, high] band (low <= high), each within +-25%");
    }
    if (cc.jumpPoints !== undefined && !(typeof cc.jumpPoints === "number" && cc.jumpPoints > 0 && cc.jumpPoints <= 25)) bad("jumpPoints must be above 0 and at most 25");
    if (cc.minCountShare !== undefined && !(typeof cc.minCountShare === "number" && cc.minCountShare > 0 && cc.minCountShare < 1)) bad("minCountShare must be between 0 and 1");
    if (!Array.isArray(cc.knownDifferences) || !cc.knownDifferences.length || cc.knownDifferences.some((d) => typeof d !== "string" || d.trim().length < 10)) {
      bad("knownDifferences must list, in plain words, how their figure differs from ours (at least one sentence)");
    }
    if (cc.compareVolumes !== undefined) {
      const v = cc.compareVolumes;
      if (!(typeof v?.tolerancePct === "number" && v.tolerancePct > 0 && v.tolerancePct <= 100)) bad("compareVolumes.tolerancePct must be above 0 and at most 100");
      if (v?.expectedRatio !== undefined && !(Array.isArray(v.expectedRatio) && v.expectedRatio.length === 2 && v.expectedRatio[0] > 0 && v.expectedRatio[0] <= v.expectedRatio[1])) {
        bad("compareVolumes.expectedRatio must be [low, high] with 0 < low <= high");
      }
    }
    if (!Array.isArray(cc.areas) || cc.areas.length < 1 || cc.areas.length > 6) {
      bad("areas must list 1 to 6 like-for-like places");
      continue;
    }
    const keys = new Set<string>();
    const known = knownParams(s);
    cc.areas.forEach((a: CrossCheckArea, i: number) => {
      const at = `areas[${i}]`;
      if (typeof a?.label !== "string" || a.label.trim().length < 2) bad(`${at}.label is missing`);
      if (typeof a?.theirs !== "string" || !a.theirs.trim()) bad(`${at}.theirs must be the publisher's key for the place`);
      else if (keys.has(a.theirs)) bad(`${at}.theirs "${a.theirs}" is listed twice`);
      else keys.add(a.theirs);
      if (!a?.ours || typeof a.ours !== "object") return bad(`${at}.ours is missing`);
      if (cc.ours === "library") {
        if (typeof a.ours.item !== "string" || !a.ours.item) bad(`${at}.ours must be { item: "<library item>" } for ours "library"`);
      } else {
        const c = String(a.ours.country ?? "").toUpperCase();
        if (!s.countries.includes(c)) bad(`${at}.ours.country must be one of this source's countries (${s.countries.join(", ")})`);
        for (const k of Object.keys(a.ours)) if (!known.has(k)) bad(`${at}.ours uses "${k}", which is not a parameter of this source's tool`);
        if (s.serves && !s.serves(a.ours)) bad(`${at}.ours would be answered by another source of the same country (this source's serves() says no)`);
      }
    });
  }
  return out;
}
