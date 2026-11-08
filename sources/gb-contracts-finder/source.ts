// UK government contract prices from Contracts Finder (Crown Commercial Service / Cabinet Office), awarded-contract notices.
// Rebuilt 8 Nov 2026: the old v2 keyword search (POST /api/rest/2/search_notices/json) was retired (302 -> /syserror/notfound) and timed out from datacenters.
// The key-free OCDS award feed replaces it. Format checked 2026-11-08 from the cloud workspace (plain GET, honest user agent):
//   https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom=2026-11-05T00:00:00&publishedTo=2026-11-05T23:59:59&stages=award&limit=100
//   -> { releases: [ { ocid, date, tag: ["award"] | ["awardUpdate"], tender: { classification: { scheme: "CPV", id: "34121000" } },
//        awards: [ { id, status: "active", date, value: { amount, currency: "GBP" } } ] } ], links: { next } }
//   limit is capped at 100 per page; links.next carries a cursor; about 125 releases are published per working day (about 1.5 s per page of 100).
//   Date-only bounds on the same day return nothing, so the harvest asks for T00:00:00 to T23:59:59. A correction arrives as another release
//   (tag awardUpdate) with the same award id: the newest release of an award is the one counted.
// Only the award id, value, publication date and the tender's CPV code are kept; buyers, suppliers and contact details in the feed are never read into the library.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "gb-contracts-finder",
  country: "GB (United Kingdom)",
  category: "government contracts (awarded contracts)",
  name: "Contracts Finder: awarded contract notices",
  publisher: "Crown Commercial Service and Cabinet Office (Contracts Finder, GOV.UK)",
  what_is_recorded:
    "Notices of awarded public contracts published on Contracts Finder by UK public buyers: what was bought (CPV product code), the publication date and the awarded value in pounds.",
  price_type: "contract_price",
  freshness: "Daily: buyers publish award notices every working day and our copy is collected once a day",
  licence:
    "Open Government Licence v3.0. Contracts Finder states: 'All content is available under the Open Government Licence v3.0 except where otherwise stated.' " +
    "Its OCDS data packages carry the licence URL http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/.",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Contracts Finder (Crown Commercial Service / Cabinet Office). Figures are ProofPrice aggregates of the published award notices.",
  homepage: "https://www.contractsfinder.service.gov.uk/",
  limits:
    "Contracts Finder awards only (central government above £12,000, wider public sector above £30,000, plus voluntary notices); some above-threshold awards appear only on Find a Tender and are not included. " +
    "The awarded value is the contract's total value as the buyer stated it, often over several years and sometimes a framework ceiling, not a unit price. " +
    "Purchases are recognised from the notice's main CPV product code. The figure covers notices published in the newest weeks only (the answer gives the dates). Aggregates only; buyers and suppliers are never read or kept.",
  method_version: "2",
};

export const FEED_URL = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";
export const PAGE_LIMIT = 100; // the feed refuses more
export const WINDOW_DAYS = 56;
export const MIN_DAYS = 28; // fewer unbroken days than this is a failed harvest, not a thin one
/** Awarded values below this are placeholders (0 and 0.01 appear often), not contract prices. */
export const MIN_VALUE = 100;
export const MAX_VALUE = 5_000_000_000;
export const UNIT = "per contract (lot), total awarded value";
export const WINDOW_PREFIX = "window:";
export const TIME_BUDGET_MS = 8.5 * 60 * 1000; // must stay under the collector's 10-minute limit (scripts/harvest.ts)
export const PAUSE_MS = 400; // between two calls
export const BLOCK_WAIT_MS = 30_000; // after a 429, wait before asking again

/** One award with only the fields we use. */
export interface GbAward {
  key: string;
  date: string; // publication date YYYY-MM-DD
  value: number;
  cpv: string; // 8 digits
  stamp: string; // release timestamp, to keep the newest release of an award
}

/** Pure: "2026-10-28" minus n days. */
export function daysBefore(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)).toISOString().slice(0, 10);
}

/** Pure: the 8-digit main CPV code of a release's tender, or "". */
export function mainCpv(release: any): string {
  const c = release?.tender?.classification;
  if (c && String(c.scheme ?? "").toUpperCase() === "CPV") {
    const m = /^(\d{8})/.exec(String(c.id ?? "").trim());
    if (m) return m[1];
  }
  return "";
}

/** Pure: a release to its usable awards (empty when it has no active GBP award with a real value or no CPV code). */
export function awardsOf(release: any): GbAward[] {
  if (!release || typeof release !== "object") return [];
  const stamp = String(release.date ?? "");
  const date = stamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const cpv = mainCpv(release);
  if (!cpv) return [];
  const out: GbAward[] = [];
  for (const a of Array.isArray(release.awards) ? release.awards : []) {
    if (!a || (a.status && a.status !== "active")) continue;
    const id = String(a.id ?? "").trim();
    const v = Number(a?.value?.amount);
    const cur = String(a?.value?.currency ?? "GBP").toUpperCase();
    if (!id || cur !== "GBP" || !Number.isFinite(v) || v < MIN_VALUE || v > MAX_VALUE) continue;
    out.push({ key: id, date, value: v, cpv, stamp });
  }
  return out;
}

/** The library items an award belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item with at least 5 distinct awards. An award seen twice (an update) counts once, as its newest release. */
export function aggregateAll(awards: Iterable<GbAward>, from: string, to: string): DailyRow[] {
  const newest = new Map<string, GbAward>();
  for (const a of awards) {
    if (a.date < from || a.date > to) continue;
    const prev = newest.get(a.key);
    if (!prev || a.stamp > prev.stamp) newest.set(a.key, a);
  }
  const groups = new Map<string, number[]>();
  for (const a of newest.values()) {
    for (const item of itemsOf(a.cpv)) {
      const g = groups.get(item);
      if (g) g.push(a.value);
      else groups.set(item, [a.value]);
    }
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Marker row: the oldest fully read day, e.g. "window:2026-09-13". No price (NO_COUNT, zeros), so no answer can show it as a figure. */
export function windowMarker(oldest: string): DailyRow {
  return { area: "ALL", item: WINDOW_PREFIX + oldest, n: NO_COUNT, median: 0, low: 0, high: 0, min: 0, max: 0 };
}
export function windowOf(rows: { area: string; item: string }[]): string | null {
  const m = rows.find((r) => r.area === "ALL" && r.item.startsWith(WINDOW_PREFIX));
  return m ? m.item.slice(WINDOW_PREFIX.length) : null;
}

export function dayUrl(day: string): string {
  return `${FEED_URL}?publishedFrom=${day}T00:00:00&publishedTo=${day}T23:59:59&stages=award&limit=${PAGE_LIMIT}`;
}

/** Pure: true when the feed's echo of the query ("uri") still carries our publishedFrom, i.e. it answered the question we asked. */
export function feedHonoured(body: any): boolean {
  return typeof body?.uri === "string" ? /[?&]publishedFrom=/.test(body.uri) : true; // fakes in tests carry no uri
}

export type FeedFetcher = (url: string) => Promise<any>;
let lastCallAt = 0;
const httpFeed: FeedFetcher = async (url) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCallAt + PAUSE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const body = await fetchJson(url, { headers: { accept: "application/json" } }, 60000);
      lastCallAt = Date.now();
      if (!body || !Array.isArray((body as any).releases)) throw new SourceError("The Contracts Finder award feed has no release list: the format may have changed");
      // 8 Nov 2026: when throttled the feed answers 200 with an EMPTY list and echoes a default query (no publishedFrom) in "uri". That is not "no awards today".
      if (!feedHonoured(body)) throw new SourceError("The Contracts Finder award feed ignored the request (throttled?): it answered a default query", String(body.uri ?? "").slice(0, 160), 503);
      return body;
    } catch (err) {
      lastCallAt = Date.now();
      lastErr = err;
      const blocked = /HTTP (403|429)/.test(String((err as any)?.message ?? err));
      await new Promise((r) => setTimeout(r, blocked ? BLOCK_WAIT_MS * (attempt + 1) : 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
};

/** Reads every award release published on one day, following the feed's cursor links. Returns the number of releases. */
export async function readDay(day: string, get: FeedFetcher, on: (release: any) => void): Promise<number> {
  let url: string | undefined = dayUrl(day);
  let count = 0;
  const seenUrls = new Set<string>();
  for (let page = 0; page < 200 && url; page++) {
    if (seenUrls.has(url)) break;
    seenUrls.add(url);
    const body = await get(url);
    for (const r of body.releases) {
      count++;
      on(r);
    }
    const next = body?.links?.next;
    url = body.releases.length && typeof next === "string" && next.startsWith(FEED_URL) ? next : undefined;
  }
  return count;
}

export interface HarvestOptions {
  get?: FeedFetcher; // for tests
  days?: number;
  budgetMs?: number;
}

export async function gbContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const days = o.days ?? WINDOW_DAYS;
  const get = o.get ?? httpFeed;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const awards: GbAward[] = [];
  const read: string[] = [];
  const failed: string[] = [];
  let releases = 0;
  let lastError: unknown = null;
  // newest day first, so a time-out loses the oldest days, never the newest
  for (let i = 0; i < days; i++) {
    const day = daysBefore(to, i);
    if (Date.now() - started > budget) {
      failed.push(`${day} (time)`);
      continue;
    }
    const dayAwards: GbAward[] = [];
    try {
      releases += await readDay(day, get, (r) => dayAwards.push(...awardsOf(r)));
      awards.push(...dayAwards);
      read.push(day);
    } catch (err) {
      failed.push(day);
      lastError = err;
    }
  }
  if (!read.length) throw new SourceError("Could not read the Contracts Finder award feed", String((lastError as any)?.message ?? lastError));
  // the window must be unbroken from today back to the oldest day we claim
  const unbroken: string[] = [];
  for (let i = 0; i < days && read.includes(daysBefore(to, i)); i++) unbroken.push(daysBefore(to, i));
  if (unbroken.length < MIN_DAYS) {
    const why = lastError ? `${String((lastError as any)?.message ?? lastError)} ${String((lastError as any)?.detail ?? "")}`.trim().slice(0, 200) : "time budget";
    throw new SourceError(`Only ${unbroken.length} unbroken days of Contracts Finder awards could be read (need ${MIN_DAYS}); not read: ${failed.slice(0, 6).join(", ")}; last error: ${why}; ${releases} releases read in ${Math.round((Date.now() - started) / 1000)} s`);
  }
  const oldest = unbroken[unbroken.length - 1];
  const used = awards.filter((a) => a.date >= oldest);
  if (!used.length) throw new SourceError("The Contracts Finder award feed held no usable award values in the window: the feed layout may have changed");
  const rows = aggregateAll(used, oldest, to);
  rows.push(windowMarker(oldest));
  return {
    date: to,
    currency: "GBP",
    unit: UNIT,
    rows,
    note: `Notices published ${oldest} to ${to}; ${releases} award releases read, ${used.length} award values used.` + (failed.length ? ` Not read: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface GbInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months?: number;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function gbContracts(input: GbInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("UK: buyer_area is not used any more; the figures are for all UK public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("UK: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `UK: "${input.what}" is not one of the purchases we summarise from the Contracts Finder notices. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("UK contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowOf(day.rows) ?? daysBefore(day.date, WINDOW_DAYS - 1);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "GB", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "GBP",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Contracts Finder award notices published ${from} to ${day.date}, recognised by their main CPV product code (${label}). Median and 10th–90th percentile of the awarded value in GBP. ` +
      "Totals per contract (lot), not unit prices; buyers and suppliers are never named.",
    describe: (s) =>
      `UK public buyers awarded ${label} with a median total value of ${fmtMoney(s.median, "GBP")} per contract ` +
      `(typical range ${fmtMoney(s.low, "GBP")} to ${fmtMoney(s.high, "GBP")}, 10th to 90th percentile). These are totals per contract (lot), not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value stated in the award notice (Contracts Finder), not a unit price", ...matched, newest_collection: day.date },
  });
}
