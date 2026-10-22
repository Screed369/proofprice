// The plug-in contract. Every data source lives in its own folder, sources/<id>/, and every tool
// (category of question) in categories/<id>/. A builder adding a source touches ONLY its own folder:
// the registry, MCP tools, REST routes, coverage, openapi.json, llms.txt, home-page examples and smoke
// tests are all generated from these manifests. See sources/_template/README.md.

import type { ZodTypeAny } from "zod";
import type { PriceAnswer } from "./answer";

/** Who published the data, under which licence, and the attribution line we must show with every figure. */
export interface SourceInfo {
  id: string; // must equal the folder name in sources/
  country: string; // human label, e.g. "GB (England & Wales)"
  category: string; // human label, e.g. "fuel (pump prices)"
  name: string;
  publisher: string;
  what_is_recorded: string;
  /** official_statistic = an average or median published by a statistics office or regulator (not built from records we hold). */
  price_type: "transaction" | "posted_pump_price" | "posted_price" | "contract_price" | "reimbursement_price" | "official_statistic";
  freshness: string;
  licence: string;
  licence_url: string;
  attribution: string;
  homepage: string;
  limits: string;
  /** Optional: bump this string when the way this source turns raw data into an answer changes (it is part of the answer_id). Default "1". */
  method_version?: string;
}

/** Loose request parameters, as they arrive from REST (strings) or MCP (typed values). */
export type Params = Record<string, unknown>;

export interface HandleContext {
  baseUrl?: string;
}

/** One aggregate row of the price library: a day, a place, an item. No row ever describes one person. */
export interface DailyRow {
  area: string; // e.g. province "28", department "69", "ALL" for the whole country
  item: string; // e.g. "diesel", "diesel/served"
  /** Number of records behind the row, or NO_COUNT (lib/stats) when the publisher gives one figure and no record count (official statistics). Never a made-up number. */
  n: number;
  median: number;
  low: number; // 10th percentile
  high: number; // 90th percentile
  min: number;
  max: number;
}

export interface HarvestResult {
  date: string; // YYYY-MM-DD that the figures describe
  currency: string;
  unit: string;
  rows: DailyRow[];
  note?: string;
}

/** One period of past aggregates. `period` is "YYYY-MM" (a month) or, for the last 90 days only, "YYYY-MM-DD" (a day). */
export interface BackfillPeriod {
  period: string;
  rows: DailyRow[];
}

/** What a source's backfill(from, to) returns: aggregates per period, never single records. The platform
 *  (lib/library/backfill.ts) applies the 5-record rule, the monthly-beyond-90-days rule and the size budget. */
export interface BackfillResult {
  currency: string;
  unit: string;
  periods: BackfillPeriod[];
  note?: string;
}

export interface Example {
  params: Record<string, string>; // REST query parameters, including country
  smoke?: boolean; // default true for the first example: checked by the Monitor after every deploy
}

/** One ready answer page on the website (/prices/<country>/<category>/<place>), described by the request it answers.
 *  Optional: a source that lists no pages gets one page per example (see SourcePlugin.pages). */
export interface PageSpec {
  /** REST query parameters of the question this page answers, including country. Same shape as an example. */
  params: Record<string, string>;
  /** Short name for headings and the URL, e.g. "Manchester" or "Milk". Default: built from the parameters. */
  label?: string;
  /** The question as a person would ask it, ending in "?". Default: built from the category and the parameters. */
  question?: string;
}

/** The most pages one source puts on the website, so the build stays fast however many examples it lists. */
export const MAX_PAGES_PER_SOURCE = 12;

export interface SourcePlugin {
  info: SourceInfo;
  /** Folder name of the tool this source answers for, e.g. "fuel" or "home-sales". */
  category: string;
  /** ISO 3166-1 alpha-2 codes this source answers for (GB, not UK). */
  countries: string[];
  /** Shown in the tool's country parameter, e.g. "ES = Spain". */
  countryHelp: string;
  /** Used in tool descriptions, e.g. "Spain" or "Singapore public housing". */
  placeName: string;
  status: "live" | "beta";
  /** Extra notes appended to the shared tool's parameter descriptions, e.g. { area: "ES: province code ('28' = Madrid)" }. */
  paramNotes?: Record<string, string>;
  /** Extra allowed values for the tool's enum parameters, e.g. { property_type: ["condo"] }. */
  paramValues?: Record<string, string[]>;
  /** Brand-new parameters only this source needs (zod schemas, optional). */
  extraParams?: Record<string, ZodTypeAny>;
  /** Working example requests. The first is a production smoke test unless smoke:false. */
  examples: Example[];
  /** Optional: the ready answer pages this source gets on the website (a few places or items worth a page of their own, at most
   *  MAX_PAGES_PER_SOURCE). Leave it out and every example becomes a page. A page shows a real figure when the source can answer
   *  from the price library without the network, and the "ask live" form (question, tool, REST link, no number) otherwise. */
  pages?: PageSpec[];
  /** One plain sentence for the /method page. */
  method?: string;
  /** Optional: when several sources of a category cover the same country, say whether this one answers the (prepared) request.
   *  The first source that says yes is used; if none does, the first source for the country. Leave out when one source per country. */
  serves?(params: Params): boolean;
  /** Answer one request. Throw SourceError for bad input or an unreachable source. */
  handle(params: Params, ctx: HandleContext): Promise<PriceAnswer>;
  /** Optional: called once a day by the collector (GitHub Actions) to add a day of aggregates to the library. */
  harvest?(): Promise<HarvestResult>;
  /** Optional: load past data (from, to are YYYY-MM-DD, inclusive) as aggregates. Run by hand through the backfill workflow
   *  (.github/workflows/backfill.yml), never in the app. Stream big files; never keep raw rows. */
  backfill?(from: string, to: string): Promise<BackfillResult>;
  /** Set true when harvest() writes rows with n: NO_COUNT because the publisher gives one figure and no record count.
   *  Answers and history built from the library report sample_size null, also for older stored rows that still carry the former
   *  placeholder count (5 or 10), which is never shown. */
  nominalCounts?: boolean;
  /** Optional: map a request to the library keys used by harvest, so /history can answer. */
  historyKey?(params: Params, opts?: { monthly?: boolean }): { area: string; item: string; label: string } | null;
  /** Optional: this source can stand in for other sources of the same category, in the given countries, when they cannot be
   *  reached. runCategory (lib/registry.ts) tries it only after the primary source failed with an outage (timeout, network error,
   *  5xx) AND no library copy of the primary from the last 7 days exists. The answer stays this source's own answer (its source,
   *  licence, attribution, price_type, evidence); the notice and extra.fallback_for say it stands in. The registry gate checks that
   *  every listed source exists in the same category and that every listed country is one of theirs. */
  fallbackFor?: {
    /** Ids of the sources this one can stand in for, e.g. ["it-fuel", "fr-fuel"]. */
    sources: string[];
    /** ISO codes it can answer for when standing in, e.g. ["IT", "FR"]. Each must be a country of one of `sources`. */
    countries: string[];
    /** Short name for the notice sentence, e.g. "the European Commission Weekly Oil Bulletin". Default: info.name. */
    label?: string;
  };
  /** Optional: the source harvests (for its own answers or stale-if-error) but offers no /history; the text says why and is
   *  the error a history request gets. Such a source is left out of the history countries everywhere (tools, OpenAPI). */
  noHistory?: string;
  /** Set true when harvest() dates its rows by the publication's reference period (a month or quarter the figure is for), not by
   *  the day it was collected. A stale-if-error copy is then recent when the collector last succeeded within STALE_MAX_DAYS
   *  (the newest figure is still the newest the publisher has), and the answer states the reference date it is for. */
  referenceDates?: boolean;
  /** Optional: the outside check (see CrossCheck). Internal only: never shown in answers, tools, REST, coverage or pages. */
  crossCheck?: CrossCheck;
}

// ---------- outside check (crossCheck): our figure next to the publisher's own headline figure ----------
// A tripwire, not a judge (Simon, 22 Oct 2026). Run only by scripts/crosscheck.ts on GitHub Actions; results go to
// library/_crosscheck/<source>.csv. Nothing here reaches an answer, a tool, a REST path or a web page.
// Design note: Notion "crossCheck design" under ProofPrice HQ. The registry gate (crossCheckProblems in lib/crosscheck.ts) checks every field.

/** One figure the publisher states for a place (and item), read from its official file. */
export interface CrossCheckHeadline {
  /** Matches CrossCheckArea.theirs, e.g. "E08000035" (UK HPI area code) or "ES/diesel". */
  key: string;
  value: number;
  /** The period the publisher states the figure for: "YYYY-MM" or "YYYY-MM-DD". */
  period: string;
  /** Their count where they publish one (e.g. sales per month), in the same unit as our figure's n. Used only by compareVolumes. */
  n?: number | null;
}

/** Our figure for one place, as compared. */
export interface CrossCheckOurs {
  value: number;
  /** "YYYY-MM" or "YYYY-MM-DD", or a span "YYYY-MM-DD..YYYY-MM-DD". */
  period: string;
  /** Records behind it (or per month, if the source says so in ourFigure). Null when the publisher gives no count. */
  n?: number | null;
}

export interface CrossCheckContext {
  /** One plain GET with the honest ProofPrice user agent. Retried on network errors, 429 and 5xx; memoised for the run, so a file
   *  several sources compare with (the Oil Bulletin) is downloaded once. With optional: true a 404 gives null instead of an error. */
  get(url: string, kind: "text", opts?: { optional?: boolean }): Promise<string | null>;
  get(url: string, kind: "binary", opts?: { optional?: boolean }): Promise<Buffer | null>;
  now: Date;
}

/** One place to compare: our request and the publisher's key for the same place. */
export interface CrossCheckArea {
  /** Plain name for the report, e.g. "Leeds" or "Spain, diesel". */
  label: string;
  /** The publisher's key for this place (CrossCheckHeadline.key). */
  theirs: string;
  /** ours "api": the REST query (country included) asked of proofprice.com with ppcheck=1. ours "library": { item } (the
   *  national roll-up of that item on the publisher's date, from library/<source>/). */
  ours: Record<string, string>;
}

export interface CrossCheck {
  /** The official file or API we read their figure from (the raw release, never news). https only, one plain GET. */
  headlineUrl: string;
  /** The human page of the release, for the report. */
  releasePage: string;
  publisher: string;
  /** What THEY publish. */
  statistic: "mean" | "median" | "weighted mean" | "average";
  /** What we compare it with. */
  ourMeasure: "median" | "mean" | "n-weighted mean of area medians" | "published average";
  /** The EXACT official series, e.g. "CSO HPM07, moving 12-month median, Existing dwellings, Filings, all buyer types". */
  series: string;
  /** How often the publisher releases (the runner writes one row per area per release). */
  cadence: "weekly" | "monthly";
  /** Where our figure comes from: the live API (with ppcheck=1, never counted as a customer) or our own library roll-up. */
  ours: "api" | "library";
  /** 1 to 6 places, each a like-for-like match. */
  areas: CrossCheckArea[];
  /** How far (in percent) the gap may sit outside the expected bias before it is SUSPECT; within this of zero it AGREES. */
  tolerancePct: number;
  /** The gap we expect from known differences in method (percent, ours above theirs = positive): one number or a [low, high] band.
   *  A gap inside the band but beyond tolerancePct is EXPLAINED (silent). Default 0. */
  expectedBiasPct?: number | [number, number];
  /** The real alarm: SUSPECT when the gap moves by more than this many percentage points from its usual level (median of the
   *  last 4 releases). Default 1.5. */
  jumpPoints?: number;
  /** Plain-words differences between their figure and ours, shown with any flag. At least one. */
  knownDifferences: string[];
  /** Also compare our n with their count (caught the Bristol boundary in the pilot). Ratio ours/theirs; SUSPECT when it falls
   *  outside expectedRatio (default [1, 1]) by more than tolerancePct. */
  compareVolumes?: { tolerancePct: number; expectedRatio?: [number, number] };
  /** Only compare when our period and theirs are the same month or day (copies of one table: EIA, CBS). */
  samePeriod?: boolean;
  /** ours "library": the inside count check. SUSPECT when the day's records are below this share of the 7-day median. Default 0.8. */
  minCountShare?: number;
  /** Read the publisher's figures for every area (pure parser behind it, tested with a fixture copied from the live format). */
  fetch(ctx: CrossCheckContext): Promise<CrossCheckHeadline[]>;
  /** ours "api": turn our answer into the figure to compare. Default: price.value, sample_size, statistic.reference_period or period. */
  ourFigure?(answer: PriceAnswer): CrossCheckOurs | null;
}

/** One country entry of a tool description, filled from the registry (the source's placeName, countries and info), never typed by hand in a category. */
export interface ToolPlace {
  place: string; // the source's placeName, e.g. "Spain" or "Singapore public housing"
  code: string; // ISO country code this entry is for (one entry per country a source covers)
  freshness: string;
  /** SourceInfo.price_type of the source behind this entry. */
  priceType: SourceInfo["price_type"];
  /** "Official statistic (published average or median)", "Posted pump price ..." : the label the website shows for the price type. */
  priceTypeLabel: string;
  sourceName: string;
  publisher: string;
  /** SourceInfo.what_is_recorded: one sentence on what a record is. */
  whatIsRecorded: string;
}

export interface CategoryPlugin {
  id: string; // must equal the folder name in categories/
  /** MCP tool name. Never rename once public: agents and directories rely on it. */
  tool: string;
  /** REST path: /api/v1/<restPath> */
  restPath: string;
  title: string;
  /** Plural noun for "not covered" messages, e.g. "Live fuel prices". */
  noun: string;
  /** MCP tool description, built from what the registry knows about each source behind the tool, so it never goes stale. */
  description(places: ToolPlace[]): string;
  /** Base help for the country parameter; country codes are appended. */
  countryHelp?: string;
  /** Parameters other than country (zod). Use .optional() for anything not always required. */
  params: Record<string, ZodTypeAny>;
  /** REST parameters that are always required (for openapi.json). */
  required?: string[];
  /** Normalise parameters once for every source (e.g. fuel name aliases). Throw SourceError if invalid. */
  prepare?(params: Params): Params;
  /** Optional: refuse a request the chosen source would only pretend to answer (an option that source ignores). Runs after the source is
   *  picked; `sourceFor(country)` names the source id that answers a country for the same request; `countries` lists the category's countries. Throw InputError (HTTP 400). */
  guard?(src: SourcePlugin, prepared: Params, sourceFor: (country: string) => string | undefined, countries: string[]): void;
  /** How long the CDN may reuse an answer (seconds). Fuel: 600. Home sales: 86400. Default 600. */
  cacheSeconds?: number;
  /** Optional history tool built from the price library. Shown to agents once enough days are collected. */
  history?: {
    tool: string;
    title: string;
    description: string;
    minDays: number; // the history tool is offered to agents once this many days are collected
    itemLabel?(item: string): string;
    unit?(item: string): string;
  };
}

export function defineSource(s: SourcePlugin): SourcePlugin {
  return s;
}

export function defineCategory(c: CategoryPlugin): CategoryPlugin {
  return c;
}

/** Read a parameter as a trimmed string, or undefined. */
export function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/** Read a parameter as a number, or undefined. */
export function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
