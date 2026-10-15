// The registry: everything about tools and sources is derived from the plug-in folders.
// MCP tools, REST routes, coverage, openapi.json, llms.txt, the home page and the smoke tests all read from here.

import { z, ZodTypeAny } from "zod";
import { CATEGORY_MODULES, SOURCE_MODULES } from "./registry.generated";
import type { CategoryPlugin, HandleContext, Params, SourceInfo, SourcePlugin, ToolPlace } from "./plugin";
import { num } from "./plugin";
import { PRICE_TYPE_LABEL } from "./price-types";
import { normaliseCountry } from "./countries";
import { InputError, SourceError, isSourceOutage, withDeadline } from "./http";
import { PriceAnswer, fmtMoney, METHOD_URL } from "./answer";
import { readDaily, readMeta } from "./library/store";
import { staleAnswer } from "./stale";
import { MIN_PUBLISH } from "./stats";
import { joinAnd } from "./text";

export const CATEGORIES: CategoryPlugin[] = CATEGORY_MODULES;
export const SOURCE_PLUGINS: SourcePlugin[] = SOURCE_MODULES;
export const SOURCES: Record<string, SourceInfo> = Object.fromEntries(SOURCE_PLUGINS.map((s) => [s.info.id, s.info]));

export function sourcesFor(categoryId: string): SourcePlugin[] {
  return SOURCE_PLUGINS.filter((s) => s.category === categoryId);
}

export function categoryById(id: string): CategoryPlugin | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function categoryByRestPath(p: string): CategoryPlugin | undefined {
  return CATEGORIES.find((c) => c.restPath === p);
}

/** Countries a category covers, in a stable order. */
export function countriesFor(categoryId: string): string[] {
  return [...new Set(sourcesFor(categoryId).flatMap((s) => s.countries))];
}

/** The source that answers for a country. When several sources cover the same country (for example GB has one for solar costs and one
 *  for heat pumps), the request decides: the first whose `serves(params)` says yes; without params, or when none says yes, the first. */
export function findSource(categoryId: string, country: string, params?: Params): SourcePlugin | undefined {
  const here = sourcesFor(categoryId).filter((s) => s.countries.includes(country));
  if (params && here.length > 1) return here.find((s) => s.serves?.(params)) ?? here[0];
  return here[0];
}

// ---------- parameter schemas (shared tool params + each source's notes, values and extra params) ----------

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  if (schema instanceof z.ZodOptional) return { inner: (schema as any).unwrap(), optional: true };
  return { inner: schema, optional: false };
}

function descriptionOf(schema: ZodTypeAny): string {
  return schema.description ?? unwrap(schema).inner.description ?? "";
}

export function isNumberParam(schema: ZodTypeAny): boolean {
  return unwrap(schema).inner instanceof z.ZodNumber;
}

/** The full parameter set of a category's tool, without country. */
export function paramSchemas(cat: CategoryPlugin): Record<string, ZodTypeAny> {
  const srcs = sourcesFor(cat.id);
  const out: Record<string, ZodTypeAny> = {};
  for (const [name, base] of Object.entries(cat.params)) {
    let schema = base;
    const extraValues = srcs.flatMap((s) => s.paramValues?.[name] ?? []);
    const { inner, optional } = unwrap(base);
    if (extraValues.length && inner instanceof z.ZodEnum) {
      const values = [...new Set([...extraValues, ...((inner as any).options as string[])])] as [string, ...string[]];
      schema = optional ? z.enum(values).optional() : z.enum(values);
    } else if (extraValues.length) {
      throw new Error(`Source adds values to "${name}" in ${cat.id}, but that parameter is not a list of choices`);
    }
    const notes = srcs.map((s) => s.paramNotes?.[name]).filter(Boolean);
    const desc = [descriptionOf(base), ...notes].filter(Boolean).join(" ");
    out[name] = desc ? schema.describe(desc) : schema;
  }
  const claimed = new Map<string, string>();
  for (const s of srcs) {
    for (const [name, schema] of Object.entries(s.extraParams ?? {})) {
      if (name === "country" || name in cat.params) {
        throw new Error(`${s.info.id} adds parameter "${name}", but ${cat.id} already has it: use paramNotes or paramValues instead`);
      }
      if (claimed.has(name)) {
        throw new Error(`Sources ${claimed.get(name)} and ${s.info.id} both add "${name}" to ${cat.id}: move it into categories/${cat.id}`);
      }
      claimed.set(name, s.info.id);
      out[name] = schema;
    }
  }
  return out;
}

export function countryHelp(cat: CategoryPlugin): string {
  const help = sourcesFor(cat.id).map((s) => s.countryHelp).join("; ");
  return cat.countryHelp ? `${cat.countryHelp} ${help}` : help;
}

/** Zod shape for the MCP tool: country (enum of covered countries) + every parameter. */
export function toolShape(cat: CategoryPlugin): Record<string, ZodTypeAny> {
  const countries = countriesFor(cat.id);
  if (!countries.length) throw new Error(`No sources for category ${cat.id}`);
  return { country: z.enum(countries as [string, ...string[]]).describe(countryHelp(cat)), ...paramSchemas(cat) };
}

/** One entry per source and country behind a tool, with what the registry knows about it. Category descriptions are written
 *  from this, never with country names typed in, so they cannot go stale when a source is added. */
export function toolPlaces(cat: CategoryPlugin): ToolPlace[] {
  return sourcesFor(cat.id).flatMap((s) =>
    s.countries.map((code) => ({
      place: s.placeName,
      code,
      freshness: s.info.freshness,
      priceType: s.info.price_type,
      priceTypeLabel: PRICE_TYPE_LABEL[s.info.price_type] ?? s.info.price_type,
      sourceName: s.info.name,
      publisher: s.info.publisher,
      whatIsRecorded: s.info.what_is_recorded,
    })),
  );
}

export function toolDescription(cat: CategoryPlugin): string {
  return cat.description(toolPlaces(cat));
}

/** REST query string -> params. Every query parameter is passed through (aliases like `department` keep working). */
export function paramsFromQuery(cat: CategoryPlugin, q: URLSearchParams): Params {
  const schemas = paramSchemas(cat);
  const out: Params = {};
  for (const [k, v] of q.entries()) {
    if (v === "") continue;
    out[k] = schemas[k] && isNumberParam(schemas[k]) ? Number(v) : v;
  }
  return out;
}

// ---------- answering ----------

/** Which source answers a request, and the request after the category's own normalisation (country upper-cased, fuel aliases ...).
 *  Throws InputError for a missing or uncovered country or invalid input. Shared by runCategory, runHistory and the answer pages. */
export function pickSource(cat: CategoryPlugin, params: Params): { src: SourcePlugin; prepared: Params } {
  const country = normaliseCountry(params.country);
  const covered = countriesFor(cat.id);
  if (!country) throw new InputError(`country is required: one of ${covered.join(", ")}.`);
  const src = findSource(cat.id, country);
  if (!src) {
    const labels = sourcesFor(cat.id).map((s) => s.info.country);
    throw new InputError(`${cat.noun} are available for ${joinAnd(labels)} so far. Not yet: ${String(params.country)}.`);
  }
  const withCountry = { ...params, country };
  const prepared = cat.prepare ? cat.prepare(withCountry) : withCountry;
  return { src: findSource(cat.id, country, prepared) ?? src, prepared };
}

/** The longest one live answer may take, in milliseconds. Vercel stops a function after 60 s (maxDuration) with a bare "Task timed
 *  out" and no answer at all, so we give up on a slow official source well before that: the caller then gets our library copy
 *  (stale-if-error) or a plain error within this time. The REST routes, the MCP category tools and the price check all answer
 *  through runCategory, so this one limit bounds all of them. */
export const ANSWER_DEADLINE_MS = 40_000;

export interface RunOptions {
  /** Replaces ANSWER_DEADLINE_MS. Tests pass a few milliseconds. */
  deadlineMs?: number;
}

/** Answer one request. Stale-if-error lives here, once, for every source: if the live official source times out, cannot be
 *  reached or answers with a server error, and the price library holds a recent snapshot for this source, area and item
 *  (a source with harvest() and historyKey()), the answer comes from that snapshot (lib/stale.ts) instead of a 502.
 *  Bad input, an unrecognised reply and sources without library data still fail as before.
 *  A source that has not answered within the deadline counts as down: it fails with a SourceError (status 504) that takes the
 *  same stale-if-error path, so a hung source never holds a request until the platform's own 60 s limit. */
export async function runCategory(cat: CategoryPlugin, params: Params, ctx: HandleContext = {}, opts: RunOptions = {}): Promise<PriceAnswer> {
  const { src, prepared } = pickSource(cat, params);
  const deadlineMs = opts.deadlineMs ?? ANSWER_DEADLINE_MS;
  try {
    return await withDeadline((async () => src.handle(prepared, ctx))(), deadlineMs, () => {
      console.warn(`[deadline] ${src.info.id} did not answer within ${deadlineMs} ms`);
      return new SourceError(
        `The official source did not respond within ${Math.max(1, Math.round(deadlineMs / 1000))} seconds, so ProofPrice stopped waiting. Try again in a minute.`,
        `source ${src.info.id}`,
        504,
      );
    });
  } catch (err) {
    if (isSourceOutage(err)) {
      const stale = staleAnswer({ cat, src, params: prepared, query: knownParams(cat, prepared), error: err, baseUrl: ctx.baseUrl });
      if (stale) {
        console.warn(`[stale-if-error] ${src.info.id}: ${(err as Error).message}; answered from the library copy of ${stale.as_of}`);
        return stale;
      }
    }
    throw err;
  }
}

// ---------- history (from the price library) ----------

export interface HistoryAnswer {
  query: Record<string, unknown>;
  status: "ok" | "insufficient_history" | "no_history_yet";
  currency: string | null;
  unit: string | null;
  series: { date: string; median: number; typical_low: number; typical_high: number; sample_size: number }[];
  period: { from: string | null; to: string | null };
  change: null | { from_median: number; to_median: number; absolute: number; percent: number };
  sample_size_note?: string;
  price_type: string;
  source: PriceAnswer["source"];
  library: { first_date: string | null; last_date: string | null; days_collected: number; days_since_last_snapshot: number | null };
  method: string;
  method_url: string;
  summary: string;
  notice: string;
}

export function historySources(cat: CategoryPlugin): SourcePlugin[] {
  return sourcesFor(cat.id).filter((s) => s.harvest && s.historyKey);
}

const daysCache = new Map<string, number>();

/** Days of history held for a category (the best source), to decide whether to offer the history tool.
 *  Read from meta.json (written by the collector) and memoised: the library cannot change inside one deployment. */
export function historyDays(cat: CategoryPlugin): number {
  if (!daysCache.has(cat.id)) {
    daysCache.set(cat.id, Math.max(0, ...historySources(cat).map((s) => readMeta(s.info.id)?.days ?? 0)));
  }
  return daysCache.get(cat.id)!;
}

/** Echo only the parameters the tool understands (never stray query-string keys). */
function knownParams(cat: CategoryPlugin, p: Params): Params {
  const keys = new Set(["country", ...Object.keys(paramSchemas(cat)), "department"]);
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => keys.has(k) && v !== undefined));
}

export function runHistory(cat: CategoryPlugin, params: Params, ctx: HandleContext = {}, today = new Date()): HistoryAnswer {
  const { src, prepared } = pickSource(cat, params);
  if (!src.harvest || !src.historyKey) {
    throw new InputError(`We do not keep daily history for ${src.info.country} ${cat.noun.toLowerCase()} yet.`);
  }
  const key = src.historyKey(prepared);
  if (!key) throw new InputError("History is kept by area and fuel; give an area or postcode and a fuel this source publishes.");
  const days = Math.max(2, Math.min(366, Math.round(num(params.days) ?? 30)));
  const meta = readMeta(src.info.id);
  // The window ends on the last day the library holds (normally today), so a late deploy never hides the data.
  const todayIso = today.toISOString().slice(0, 10);
  const to = meta?.last_date ?? todayIso;
  const end = new Date(to + "T00:00:00Z");
  const from = new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(src.info.id, { area: key.area, item: key.item, from, to }).filter((r) => r.n >= MIN_PUBLISH);
  const staleDays = meta?.last_date ? Math.max(0, Math.round((Date.parse(todayIso) - Date.parse(meta.last_date)) / 86400000)) : null;
  const unit = cat.history?.unit?.(key.item) ?? meta?.unit ?? null;
  const currency = meta?.currency ?? null;
  const itemLabel = cat.history?.itemLabel?.(key.item) ?? key.item;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const change =
    rows.length >= 2
      ? {
          from_median: first.median,
          to_median: last.median,
          absolute: Math.round((last.median - first.median) * 1000) / 1000,
          percent: Math.round(((last.median - first.median) / first.median) * 1000) / 10,
        }
      : null;
  const money = (v: number) => (currency ? fmtMoney(v, currency) : String(v));
  const status: HistoryAnswer["status"] = rows.length >= 2 ? "ok" : rows.length === 1 ? "insufficient_history" : "no_history_yet";
  const summary =
    status === "ok"
      ? `${itemLabel} in ${key.label}: median ${money(last.median)} ${unit ?? ""} on ${last.date}, ` +
        `${change!.percent === 0 ? "unchanged" : change!.percent > 0 ? `up ${change!.percent}%` : `down ${Math.abs(change!.percent)}%`} ` +
        `since ${first.date} (${money(first.median)}). ${rows.length} daily snapshots of ${src.info.publisher}.`
      : status === "insufficient_history"
        ? `Only one day of history so far for ${itemLabel} in ${key.label} (${last.date}: median ${money(last.median)}). History builds up daily.`
        : `No history yet for ${itemLabel} in ${key.label}. ProofPrice snapshots this source once a day; history builds up from the first collection.`;
  const src_ = src.info;
  return {
    query: { ...knownParams(cat, prepared), days, area_key: key.area, item: key.item },
    status,
    currency,
    unit,
    ...(src.nominalCounts ? { sample_size_note: "The publisher gives one figure and no record count; sample_size in the series is a placeholder (5) kept so the day passes the 5-record rule. It is not a count of records." } : {}),
    series: rows.map((r) => ({ date: r.date, median: r.median, typical_low: r.low, typical_high: r.high, sample_size: r.n })),
    period: { from: first?.date ?? null, to: last?.date ?? null },
    change,
    price_type: src_.price_type,
    source: {
      id: src_.id,
      name: src_.name,
      publisher: src_.publisher,
      licence: src_.licence,
      licence_url: src_.licence_url,
      attribution: src_.attribution,
      url: src_.homepage,
    },
    library: {
      first_date: meta?.first_date ?? null,
      last_date: meta?.last_date ?? null,
      days_collected: meta?.days ?? 0,
      days_since_last_snapshot: staleDays,
    },
    method:
      "Once a day ProofPrice takes a snapshot of the official source and stores, for each area and item, the median, 10th–90th percentile and count. " +
      `Days with fewer than ${MIN_PUBLISH} records are not shown.`,
    method_url: (ctx.baseUrl ?? "") + METHOD_URL,
    summary,
    notice: "Information, not an offer. Each point is that day's snapshot of posted prices.",
  };
}

// ---------- examples, coverage ----------

export function exampleUrls(): { category: string; source: string; path: string; smoke: boolean }[] {
  const out: { category: string; source: string; path: string; smoke: boolean }[] = [];
  for (const s of SOURCE_PLUGINS) {
    const cat = categoryById(s.category);
    if (!cat) continue;
    s.examples.forEach((ex, i) => {
      out.push({
        category: cat.id,
        source: s.info.id,
        path: `/api/v1/${cat.restPath}?${new URLSearchParams(ex.params).toString()}`,
        smoke: ex.smoke ?? i === 0,
      });
    });
  }
  return out;
}

export const COMING_NEXT = [
  "More countries and more kinds of price, one official source at a time (see the sources list for what is live)",
  "Verified receipts",
];

const COVERAGE_PURPOSE = "Real prices actually paid, from official records, in one place for AI agents.";

const COVERAGE_RULES = [
  "Every answer carries its period, confidence, source and licence. Most are a range (median, 10th–90th percentile) with the sample size.",
  "Official statistics (price_type official_statistic, e.g. Eurostat household energy prices) are an average or median published by a statistics office or regulator, with its reference period: no range, and no sample size unless the publisher gives one.",
  "No range is published from fewer than 5 records.",
  "Aggregates only: no individual addresses or personal data are returned for home sales.",
  "Information, not a valuation or offer.",
];

/** The complete coverage list, for GET /api/v1/coverage (the smoke test and the Monitor read its examples). Every source in full:
 *  about 140 KB. AI agents get the short version below (coverageView) from the MCP tool. */
export function coverage() {
  return {
    service: "ProofPrice",
    purpose: COVERAGE_PURPOSE,
    tools: CATEGORIES.map((c) => ({
      name: c.tool,
      rest: `/api/v1/${c.restPath}`,
      countries: sourcesFor(c.id).map((s) => s.info.country),
    })),
    sources: SOURCE_PLUGINS.map((s) => s.info),
    examples: exampleUrls().map((e) => e.path),
    rules: COVERAGE_RULES,
    coming_next: COMING_NEXT,
  };
}

// ---------- coverage for AI agents: short unless a slice is asked for ----------

/** The REST path of the complete coverage list. */
export const COVERAGE_PATH = "/api/v1/coverage";

/** How often a source is updated, as one short phrase: the first sentence of its freshness text. A sentence longer than `max`
 *  characters is cut before its first parenthesis if that leaves a phrase, else at a word, and ends in "…". */
export function updateFrequency(freshness: string, max = 100): string {
  const first = freshness.replace(/\s+/g, " ").trim().split(/\.\s/)[0].replace(/\.$/, "");
  if (first.length <= max) return first;
  const aside = first.slice(0, max).indexOf(" (");
  if (aside >= 12) return first.slice(0, aside) + "…";
  let cut = first.slice(0, max);
  if (!/\s/.test(first[max])) cut = cut.replace(/\s+\S*$/, ""); // do not end in the middle of a word
  return cut.replace(/[\s,;:(]+$/, "") + "…";
}

/** A category by its id, REST path or tool name (any case; /api/v1/ in front is ignored). */
export function lookupCategory(raw: unknown, categories: CategoryPlugin[] = CATEGORIES): CategoryPlugin | undefined {
  const key = String(raw ?? "").trim().toLowerCase().replace(/^\/?(api\/v1\/)?/, "");
  return key ? categories.find((c) => c.id.toLowerCase() === key || c.restPath.toLowerCase() === key || c.tool.toLowerCase() === key) : undefined;
}

export interface CoverageFilter {
  /** A category id, REST path or tool name. */
  category?: string;
  /** An ISO country code (or a common country name). */
  country?: string;
}

/** What the MCP tool pricepaid_coverage answers. By default a short overview of about 11 KB: per category the tool, the countries,
 *  how many sources stand behind it and how often they update, plus where to read the complete list. The complete list is large
 *  (about 140 KB: every source with its licence, attribution and limits), and a tool answer that size is slow to deliver and fills
 *  an AI's context, so the full detail is given per slice instead: ask for a category and/or a country and you get the sources
 *  that match, in full. GET /api/v1/coverage (coverage()) is unchanged and still lists everything. */
export function coverageView(filter: CoverageFilter = {}, baseUrl = "") {
  const wantCategory = (filter.category ?? "").trim();
  const wantCountry = (filter.country ?? "").trim();
  const category = wantCategory ? lookupCategory(wantCategory) : undefined;
  if (wantCategory && !category) {
    throw new InputError(`category must be one of: ${CATEGORIES.map((c) => c.id).join(", ")} (the REST path or the tool name also works).`);
  }
  const country = wantCountry ? normaliseCountry(wantCountry) : null;
  if (wantCountry && !country) throw new InputError("country must be an ISO country code such as IE, GB or FR (a common country name also works).");

  const matching = (c: CategoryPlugin) => sourcesFor(c.id).filter((s) => !country || s.countries.includes(country));
  const tools = (category ? [category] : CATEGORIES)
    .filter((c) => matching(c).length > 0)
    .map((c) => {
      const srcs = matching(c);
      return {
        name: c.tool,
        category: c.id,
        rest: `/api/v1/${c.restPath}`,
        countries: [...new Set(srcs.flatMap((s) => s.countries))],
        source_count: srcs.length,
        update_frequency: [...new Set(srcs.map((s) => updateFrequency(s.info.freshness)))].join(" | "),
      };
    });
  const shown = (category ? [category] : CATEGORIES).flatMap((c) => matching(c).map((s) => ({ c, s })));
  const fullUrl = baseUrl + COVERAGE_PATH;
  const scope = [category ? `category ${category.id}` : "", country ? `country ${country}` : ""].filter(Boolean).join(", ");
  const covered = category ? countriesFor(category.id) : [...new Set(CATEGORIES.flatMap((c) => countriesFor(c.id)))];

  const summary = !scope
    ? `${shown.length} official sources stand behind ${tools.length} price tools. This is the short overview. ` +
      `For the full detail of a slice (publisher, licence, attribution, limits, examples) call pricepaid_coverage with a category and/or a country; ` +
      `${fullUrl} lists every source at once.`
    : shown.length
      ? `Full detail for ${shown.length} source${shown.length === 1 ? "" : "s"} (${scope}): publisher, licence, attribution, limits and example requests.`
      : `No ProofPrice source covers ${scope}. Countries covered${category ? ` for ${category.id}` : ""}: ${covered.join(", ")}.`;

  return {
    service: "ProofPrice",
    purpose: COVERAGE_PURPOSE,
    detail: scope ? ("full" as const) : ("summary" as const),
    summary,
    full_coverage_url: fullUrl,
    source_count: shown.length,
    tools,
    ...(scope
      ? {
          filter: { ...(category ? { category: category.id } : {}), ...(country ? { country } : {}) },
          sources: shown.map(({ c, s }) => ({ ...s.info, tool: c.tool, countries: s.countries, status: s.status })),
          examples: exampleUrls()
            .filter((e) => shown.some(({ s }) => s.info.id === e.source))
            .map((e) => e.path),
        }
      : {}),
    rules: COVERAGE_RULES,
    coming_next: COMING_NEXT,
  };
}
