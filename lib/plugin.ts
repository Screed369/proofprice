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
  /** Set true when harvest() writes a placeholder count (n: 5) because the publisher gives one figure and no record count.
   *  Answers and history built from the library then report sample_size null instead of a count that is not real. */
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
  /** Set for a source whose figure is one published average or median (an official statistic): the stale-if-error copy then says "average"
   *  (or "median") and carries the statistic block, instead of the median of a range built from records. */
  statisticMeasure?: "average" | "median";
  /** Set true when harvest() dates its rows by the publication's reference period (a month or quarter the figure is for), not by
   *  the day it was collected. A stale-if-error copy is then recent when the collector last succeeded within STALE_MAX_DAYS
   *  (the newest figure is still the newest the publisher has), and the answer states the reference date it is for. */
  referenceDates?: boolean;
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
  /** How long the CDN may reuse an answer (seconds). Fuel: 600. Home sales: 86400. Default 600. */
  cacheSeconds?: number;
  /** Set to a plain explanation when the price-check verdict tool (pricepaid_check_price) must refuse this category, for example because
   *  a verdict on a rate would read as financial advice. The tool then says this text instead of judging, and leaves the category out of its lists. */
  noPriceCheck?: string;
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
