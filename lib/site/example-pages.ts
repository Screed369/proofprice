// Ready answer pages for EVERY source, with nothing to edit when a source is added.
//
// Which pages exist is decided by the registry alone (plan): each source lists the requests worth a page of their own in its
// manifest (`pages`, default: its `examples`), capped at MAX_PAGES_PER_SOURCE. What a page SAYS is decided at build time (build):
//
//   1. The source answers the request from the price library without the network (rents, home prices, ONS price levels, BLS
//      averages ...): the page shows exactly what the API answers, so every rule of the source (at least 5 records, an official
//      statistic with its reference period) is applied by the source itself.
//   2. The source has a daily library with a row for the request (a source with harvest() and historyKey()): the page shows
//      that row, only when it rests on at least 5 records.
//   3. Otherwise (a live-only source): the "ask live" form, with the question, the MCP tool, the REST link and NO number.
//
// The network is switched off while a page is prepared (lib/site/offline.ts), so a build never calls a government site.

import { fmtMoney, type PriceAnswer } from "../answer";
import { normaliseCountry } from "../countries";
import { readLatestDay, readMeta, type LibraryRow, type SourceMeta } from "../library/store";
import { MAX_PAGES_PER_SOURCE, type CategoryPlugin, type PageSpec, type SourceInfo, type SourcePlugin } from "../plugin";
import { PRICE_TYPE_BASIS } from "../price-types";
import { SOURCE_PLUGINS, categoryById, findSource, paramsFromQuery, pickSource } from "../registry";
import { MIN_PUBLISH, confidenceLabel } from "../stats";
import { CATEGORY_LABEL, PAGE_SOURCES, noFullStop, pageSourceOf, shortPublisher, type PageSource } from "./answer-pages";
import { countryName } from "./areas";
import { SITE_URL } from "./constants";
import { int, longDate } from "./format";
import { runOffline } from "./offline";
import { inCountry, slugOf, wordingFor } from "./page-wording";

// ---------- plan: which pages exist (pure, from the registry) ----------

export interface PagePlan {
  path: string; // /prices/gb/rent/manchester
  slug: string;
  sourceId: string;
  country: string; // "GB"
  countrySlug: string; // "gb"
  countryName: string;
  category: string; // registry category id: "rent", "home-sales", "farm-prices" ...
  categoryLabel: string;
  label: string;
  question: string;
  params: Record<string, string>; // REST query parameters, country upper-cased
  tool: string;
  restPath: string; // /api/v1/<restPath>
  explicit: boolean; // true when the source listed it in `pages`
}

/** Sources that have a page for every place already (PAGE_SOURCES) do not also get example pages. */
export function bulkSourceIds(): Set<string> {
  return new Set(PAGE_SOURCES.map((p) => p.sourceId));
}

export function categoryLabelOf(cat: CategoryPlugin): string {
  return CATEGORY_LABEL[cat.id] ?? cat.noun;
}

/** The pages the registry's sources ask for. Same input, same output: the sitemap, /prices and the pages all agree. */
export function planExamplePages(
  sources: SourcePlugin[] = SOURCE_PLUGINS,
  skip: Set<string> = bulkSourceIds(),
  findCategory: (id: string) => CategoryPlugin | undefined = categoryById,
  routedSource: (cat: CategoryPlugin, country: string) => SourcePlugin | undefined = (cat, c) => findSource(cat.id, c),
): PagePlan[] {
  const plans: PagePlan[] = [];
  const taken = new Map<string, Set<string>>(); // "gb/rent" -> slugs
  for (const src of sources) {
    if (skip.has(src.info.id)) continue;
    const cat = findCategory(src.category);
    if (!cat) continue;
    const defs: PageSpec[] = (src.pages ?? src.examples.map((e) => ({ params: e.params }))).slice(0, MAX_PAGES_PER_SOURCE);
    for (const def of defs) {
      const country = normaliseCountry(def.params.country);
      if (!country || !src.countries.includes(country)) continue;
      if (routedSource(cat, country) !== src) continue; // another source answers for this country: a page here would show its answer
      const params: Record<string, string> = { ...Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, String(v)])), country };
      const cName = countryName(country);
      const w = wordingFor({
        categoryId: cat.id,
        categoryNoun: cat.noun,
        countryName: cName,
        params,
        notes: src.paramNotes,
        label: def.label,
        question: def.question,
      });
      const group = `${country.toLowerCase()}/${cat.id}`;
      const used = taken.get(group) ?? new Set<string>();
      taken.set(group, used);
      const base = slugOf(w.label);
      let slug = base;
      for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
      used.add(slug);
      plans.push({
        path: `/prices/${country.toLowerCase()}/${cat.id}/${slug}`,
        slug,
        sourceId: src.info.id,
        country,
        countrySlug: country.toLowerCase(),
        countryName: cName,
        category: cat.id,
        categoryLabel: categoryLabelOf(cat),
        label: w.label,
        question: w.question,
        params,
        tool: cat.tool,
        restPath: cat.restPath,
        explicit: !!src.pages,
      });
    }
  }
  return plans;
}

let planCache: PagePlan[] | null = null;
export function examplePlans(): PagePlan[] {
  return (planCache ??= planExamplePages());
}

// ---------- build: what a page says ----------

export interface ExampleFigure {
  via: "answer" | "library"; // the source's own answer, or the row of the daily price library
  headline: string; // "£1,373"
  value: number;
  currency: string;
  unit: string; // "per month"
  measure: "median" | "average";
  /** An official statistic: the publisher's own average or median, with a reference period and no range of ours. */
  statistic: boolean;
  answer: string; // one quotable sentence from the source's answer
  n: number | null; // records behind the figure, when the source says; always 5 or more
  rangeText: string | null; // "€300,000 to €1,000,000": only for figures built from records
  confidence: "high" | "medium" | "low" | null;
  referencePeriod: string | null; // statistics: "2026-08", "2026-Q2"
  periodText: string | null; // "2025-10-02 to 2026-10-02"
  caveat: string | null;
  asOf: string; // YYYY-MM-DD
}

export interface ExamplePage {
  mode: "example";
  path: string;
  slug: string;
  sourceId: string;
  country: string;
  countrySlug: string;
  countryName: string;
  category: string;
  categoryLabel: string;
  label: string;
  h1: string; // the question
  title: string;
  description: string;
  /** null = the "ask live" form: the question, the tool and the REST link, no number. */
  figure: ExampleFigure | null;
  asOf: string | null;
  params: Record<string, string>;
  liveRestPath: string; // /api/v1/rent?country=GB&town=Manchester : the live answer
  mcpTool: string;
  mcpArgs: Record<string, string | number>;
  ask: string;
  basis: string;
  source: PageSource;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const isoOf = (s: string | null | undefined) => (s && ISO.test(s) ? s.slice(0, 10) : null);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The figure of a source's own answer, or null when it has none to show. Pure. */
export function figureFromAnswer(a: PriceAnswer, info: SourceInfo, meta: SourceMeta | null, today: string): ExampleFigure | null {
  if (a.status !== "ok" || !a.price || !finite(a.price.value) || a.price.value <= 0) return null;
  const p = a.price;
  const statistic = !!a.statistic || info.price_type === "official_statistic";
  const n = a.sample_size;
  // No figure from fewer than 5 records: a count the source states must reach the gate, and a figure built from records must state one.
  if (n !== null && n < MIN_PUBLISH) return null;
  if (!statistic && n === null) return null;
  const hasRange = !statistic && finite(p.typical_low) && finite(p.typical_high);
  const from = isoOf(a.period?.from);
  const to = isoOf(a.period?.to);
  return {
    via: "answer",
    headline: fmtMoney(p.value, p.currency),
    value: p.value,
    currency: p.currency,
    unit: p.unit,
    measure: p.measure,
    statistic,
    answer: a.summary,
    n,
    rangeText: hasRange ? `${fmtMoney(p.typical_low as number, p.currency)} to ${fmtMoney(p.typical_high as number, p.currency)}` : null,
    confidence: !statistic && (a.confidence === "high" || a.confidence === "medium" || a.confidence === "low") ? a.confidence : null,
    referencePeriod: a.statistic?.reference_period ?? null,
    periodText: from && to ? `${from} to ${to}` : to ? `to ${to}` : null,
    caveat: a.statistic?.note ?? null,
    asOf: to ?? meta?.last_date ?? today,
  };
}

/** The figure of the newest library day for a request, for a source that collects daily but answers live. Pure. */
export function figureFromLibrary(o: {
  src: SourcePlugin;
  cat: CategoryPlugin;
  prepared: Record<string, unknown>;
  day: { date: string; rows: LibraryRow[] } | null;
  meta: SourceMeta | null;
}): ExampleFigure | null {
  const { src, cat, day, meta } = o;
  if (!src.harvest || !src.historyKey || !day) return null;
  if (src.info.price_type === "official_statistic") return null; // the library n of a published figure is a placeholder, not a count
  let key: { area: string; item: string; label: string } | null = null;
  try {
    key = src.historyKey(o.prepared);
  } catch {
    return null;
  }
  if (!key) return null;
  // A national row cannot answer a request about a smaller place.
  const placeGiven = ["postcode", "area", "town", "region", "county", "department", "province", "city"].some((k) => String(o.prepared[k] ?? "").trim() !== "");
  if (key.area === "ALL" && placeGiven) return null;
  const row = day.rows.find((r) => r.area === key!.area && r.item === key!.item);
  if (!row || row.n < MIN_PUBLISH || ![row.median, row.low, row.high].every(finite) || row.median <= 0) return null;
  const currency = meta?.currency;
  const unit = cat.history?.unit?.(key.item) ?? meta?.unit;
  if (!currency || !unit) return null; // never state a price without its currency and unit
  const itemLabel = cat.history?.itemLabel?.(key.item) ?? key.item;
  const money = (v: number) => fmtMoney(v, currency);
  const conf = confidenceLabel(row.n);
  if (conf === "insufficient") return null;
  const records = src.info.price_type === "posted_pump_price" ? "stations" : "records";
  return {
    via: "library",
    headline: money(row.median),
    value: row.median,
    currency,
    unit,
    measure: "median",
    statistic: false,
    answer:
      `${itemLabel} in ${key.label}: median ${money(row.median)} ${unit} on ${longDate(day.date)}; typical range ${money(row.low)} to ${money(row.high)} ` +
      `(10th to 90th percentile) across ${int(row.n)} ${records} in the daily snapshot of ${src.info.name} (${noFullStop(src.info.publisher)}). Confidence: ${conf}.`,
    n: row.n,
    rangeText: `${money(row.low)} to ${money(row.high)}`,
    confidence: conf,
    referencePeriod: null,
    periodText: day.date,
    caveat: meta?.note ?? null,
    asOf: day.date,
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** Everything but the figure; the figure is added by the caller. Pure. */
export function pageFromPlan(plan: PagePlan, figure: ExampleFigure | null, info: SourceInfo, mcpArgs: Record<string, string | number>, today: string): ExamplePage {
  const rest = `/api/v1/${plan.restPath}?${new URLSearchParams(plan.params).toString()}`;
  const src = shortPublisher(info.publisher);
  const title = figure
    ? `${plan.label}: ${figure.headline} ${figure.unit} (${plan.categoryLabel}, ${plan.countryName})`
    : `${plan.label}: ${plan.categoryLabel} ${inCountry(plan.countryName)}, ask live`;
  const description = figure
    ? clip(`${figure.answer} Source: ${src}.`, 300)
    : `${plan.question} Ask ProofPrice with the ${plan.tool} tool or the REST API: the answer comes live from ${src}, with its period, source and licence.`;
  return {
    mode: "example",
    path: plan.path,
    slug: plan.slug,
    sourceId: plan.sourceId,
    country: plan.country,
    countrySlug: plan.countrySlug,
    countryName: plan.countryName,
    category: plan.category,
    categoryLabel: plan.categoryLabel,
    label: plan.label,
    h1: plan.question,
    title,
    description,
    figure,
    asOf: figure?.asOf ?? null,
    params: plan.params,
    liveRestPath: rest,
    mcpTool: plan.tool,
    mcpArgs,
    ask:
      `Using the ProofPrice MCP server (${plan.tool}): ${plan.question} Give the figure with its unit, the period it covers, ` +
      `the number of records where the source states one, and cite the source and licence.`,
    basis: PRICE_TYPE_BASIS[info.price_type] ?? "",
    source: pageSourceOf(info),
  };
}

const dayCache = new Map<string, { date: string; rows: LibraryRow[] } | null>();
function latestDay(sourceId: string) {
  if (!dayCache.has(sourceId)) dayCache.set(sourceId, readLatestDay(sourceId));
  return dayCache.get(sourceId)!;
}

const buildDay = () => new Date().toISOString().slice(0, 10);

export type OfflineAnswer = (src: SourcePlugin, prepared: Record<string, unknown>) => Promise<PriceAnswer>;

const liveAnswer: OfflineAnswer = (src, prepared) => runOffline(() => src.handle(prepared, { baseUrl: SITE_URL }));

/** One page: the source's own answer without the network, else the library row, else the "ask live" form. Never throws. */
export async function buildExamplePage(plan: PagePlan, answer: OfflineAnswer = liveAnswer): Promise<ExamplePage> {
  const today = buildDay();
  const base = SOURCE_PLUGINS.find((s) => s.info.id === plan.sourceId);
  const cat = categoryById(plan.category);
  if (!base || !cat) throw new Error(`Page plan ${plan.path} names an unknown source or category`);
  let figure: ExampleFigure | null = null;
  let mcpArgs: Record<string, string | number> = plan.params;
  try {
    const typed = paramsFromQuery(cat, new URLSearchParams(plan.params));
    mcpArgs = typed as Record<string, string | number>;
    const { src, prepared } = pickSource(cat, typed);
    const meta = readMeta(src.info.id);
    try {
      figure = figureFromAnswer(await answer(src, prepared), src.info, meta, today);
    } catch {
      figure = null; // live-only source (network off), or an answer the source could not give
    }
    if (!figure) figure = figureFromLibrary({ src, cat, prepared, day: latestDay(src.info.id), meta });
  } catch {
    figure = null; // an example that no longer validates is still a page, in the ask-live form; tests catch it
  }
  return pageFromPlan(plan, figure, base.info, mcpArgs, today);
}

let loading: Promise<ExamplePage[]> | null = null;

/** Every example page, built once per process (a build, or a server that happens to need them). Sequential: the work is small. */
export function loadExamplePages(): Promise<ExamplePage[]> {
  loading ??= (async () => {
    const out: ExamplePage[] = [];
    for (const plan of examplePlans()) out.push(await buildExamplePage(plan));
    return out;
  })();
  return loading;
}

export async function findExamplePage(countrySlug: string, category: string, slug: string): Promise<ExamplePage | undefined> {
  return (await loadExamplePages()).find((p) => p.countrySlug === countrySlug && p.category === category && p.slug === slug);
}

export async function examplePagesIn(countrySlug: string, category: string): Promise<ExamplePage[]> {
  return (await loadExamplePages()).filter((p) => p.countrySlug === countrySlug && p.category === category);
}
