// The registry: everything about tools and sources is derived from the plug-in folders.
// MCP tools, REST routes, coverage, openapi.json, llms.txt, the home page and the smoke tests all read from here.

import { z, ZodTypeAny } from "zod";
import { CATEGORY_MODULES, SOURCE_MODULES } from "./registry.generated";
import type { CategoryPlugin, HandleContext, Params, SourceInfo, SourcePlugin, ToolPlace } from "./plugin";
import { num } from "./plugin";
import { PRICE_TYPE_LABEL } from "./price-types";
import { normaliseCountry } from "./countries";
import { InputError, isSourceOutage } from "./http";
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

export function findSource(categoryId: string, country: string): SourcePlugin | undefined {
  return sourcesFor(categoryId).find((s) => s.countries.includes(country));
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
  return { src, prepared: cat.prepare ? cat.prepare(withCountry) : withCountry };
}

/** Answer one request. Stale-if-error lives here, once, for every source: if the live official source times out, cannot be
 *  reached or answers with a server error, and the price library holds a recent snapshot for this source, area and item
 *  (a source with harvest() and historyKey()), the answer comes from that snapshot (lib/stale.ts) instead of a 502.
 *  Bad input, an unrecognised reply and sources without library data still fail as before. */
export async function runCategory(cat: CategoryPlugin, params: Params, ctx: HandleContext = {}): Promise<PriceAnswer> {
  const { src, prepared } = pickSource(cat, params);
  try {
    return await src.handle(prepared, ctx);
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

export function coverage() {
  return {
    service: "ProofPrice",
    purpose: "Real prices actually paid, from official records, in one place for AI agents.",
    tools: CATEGORIES.map((c) => ({
      name: c.tool,
      rest: `/api/v1/${c.restPath}`,
      countries: sourcesFor(c.id).map((s) => s.info.country),
    })),
    sources: SOURCE_PLUGINS.map((s) => s.info),
    examples: exampleUrls().map((e) => e.path),
    rules: [
      "Every answer carries its period, confidence, source and licence. Most are a range (median, 10th–90th percentile) with the sample size.",
      "Official statistics (price_type official_statistic, e.g. Eurostat household energy prices) are an average or median published by a statistics office or regulator, with its reference period: no range, and no sample size unless the publisher gives one.",
      "No range is published from fewer than 5 records.",
      "Aggregates only: no individual addresses or personal data are returned for home sales.",
      "Information, not a valuation or offer.",
    ],
    coming_next: COMING_NEXT,
  };
}
