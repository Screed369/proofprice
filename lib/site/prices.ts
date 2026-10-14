// Loads the ready answer pages and offers the lookups the /prices pages, the sitemap, llms-full.txt and /sources need.
// Two kinds of page share the /prices/<country>/<category>/<place> address space:
//   bulk    one page for EVERY place of a library source (Spain, France, Italy fuel; Irish home sales), built from the newest
//           library day (answer-pages.ts, place names in areas.ts);
//   example the pages a source's manifest asks for (`pages`, default its `examples`): every other source (example-pages.ts).
// Everything here is synchronous and derived from the registry and the library files, so the sitemap and llms-full.txt never
// wait for an answer. The figures of example pages are built asynchronously (loadExamplePages) and only the page components need them.

import { readLatestDay, readMeta } from "../library/store";
import { SOURCE_PLUGINS, categoryById } from "../registry";
import { PAGE_SOURCES, buildSourcePages, type AnswerPage, type BuildResult } from "./answer-pages";
import { examplePlans } from "./example-pages";

export interface LoadedPages extends BuildResult {
  /** Library days that produced pages, by source id. */
  days: Record<string, string>;
}

let cache: LoadedPages | null = null;

/** Build the bulk answer pages from the newest library day of each source. Memoised: the library cannot change inside one build. */
export function loadAnswerPages(): LoadedPages {
  if (cache) return cache;
  const out: LoadedPages = { pages: [], skipped: [], days: {} };
  for (const spec of PAGE_SOURCES) {
    const day = readLatestDay(spec.sourceId);
    const src = SOURCE_PLUGINS.find((s) => s.info.id === spec.sourceId);
    const cat = categoryById(spec.category);
    if (!day || !src || !cat) continue;
    const res = buildSourcePages(spec, day, {
      info: src.info,
      category: { tool: cat.tool, restPath: cat.restPath, hasHistory: !!cat.history },
      currency: readMeta(spec.sourceId)?.currency,
    });
    out.pages.push(...res.pages);
    out.skipped.push(...res.skipped.map((s) => ({ ...s, code: `${spec.sourceId}:${s.code}` })));
    out.days[spec.sourceId] = day.date;
  }
  cache = out;
  return out;
}

/** The bulk pages (one per place). */
export function allAnswerPages(): AnswerPage[] {
  return loadAnswerPages().pages;
}

export function findAnswerPage(countrySlug: string, category: string, areaSlug: string): AnswerPage | undefined {
  return allAnswerPages().find((p) => p.countrySlug === countrySlug && p.category === category && p.area.slug === areaSlug);
}

// ---------- every page, as a light reference (no figures) ----------

export interface PageRef {
  mode: "bulk" | "example";
  path: string;
  sourceId: string;
  country: string;
  countrySlug: string;
  countryName: string;
  category: string; // registry category id
  categoryLabel: string;
  slug: string;
  label: string;
  asOf: string | null; // YYYY-MM-DD of the newest data behind the page, when known without building it
}

let refCache: PageRef[] | null = null;

/** Every page that exists under /prices: bulk pages first, then the pages the manifests ask for. Memoised. */
export function pageRefs(): PageRef[] {
  if (refCache) return refCache;
  const refs: PageRef[] = allAnswerPages().map((p) => ({
    mode: "bulk",
    path: p.path,
    sourceId: p.sourceId,
    country: p.country,
    countrySlug: p.countrySlug,
    countryName: p.countryName,
    category: p.category,
    categoryLabel: p.categoryLabel,
    slug: p.area.slug,
    label: p.area.label,
    asOf: p.asOf,
  }));
  for (const plan of examplePlans()) {
    refs.push({
      mode: "example",
      path: plan.path,
      sourceId: plan.sourceId,
      country: plan.country,
      countrySlug: plan.countrySlug,
      countryName: plan.countryName,
      category: plan.category,
      categoryLabel: plan.categoryLabel,
      slug: plan.slug,
      label: plan.label,
      asOf: readMeta(plan.sourceId)?.last_date ?? null,
    });
  }
  refCache = refs;
  return refs;
}

export interface CategoryGroup {
  mode: "bulk" | "example";
  category: string; // registry category id
  label: string;
  path: string; // /prices/es/fuel
  sourceId: string;
  asOf: string | null;
  refs: PageRef[];
}

export interface CountryGroup {
  slug: string;
  code: string;
  name: string;
  path: string; // /prices/es
  categories: CategoryGroup[];
}

const newest = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** Pages grouped by country, then category. */
export function countryGroups(): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const p of pageRefs()) {
    let g = groups.get(p.countrySlug);
    if (!g) {
      g = { slug: p.countrySlug, code: p.country, name: p.countryName, path: `/prices/${p.countrySlug}`, categories: [] };
      groups.set(p.countrySlug, g);
    }
    let c = g.categories.find((x) => x.category === p.category);
    if (!c) {
      c = { mode: p.mode, category: p.category, label: p.categoryLabel, path: `/prices/${p.countrySlug}/${p.category}`, sourceId: p.sourceId, asOf: null, refs: [] };
      g.categories.push(c);
    }
    c.refs.push(p);
    c.asOf = newest(c.asOf, p.asOf);
  }
  for (const g of groups.values()) g.categories.sort((a, b) => a.label.localeCompare(b.label, "en"));
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function findCategoryGroup(countrySlug: string, category: string): { country: CountryGroup; group: CategoryGroup } | undefined {
  const country = countryGroups().find((g) => g.slug === countrySlug);
  const group = country?.categories.find((c) => c.category === category);
  return country && group ? { country, group } : undefined;
}

/** The /prices page(s) of a source: one per country it has pages for. Empty when it has none. */
export function pricesPathsFor(sourceId: string): { country: string; path: string }[] {
  const out: { country: string; path: string }[] = [];
  for (const g of countryGroups()) for (const c of g.categories) if (c.sourceId === sourceId) out.push({ country: g.name, path: c.path });
  return out;
}

export function pricesPathFor(sourceId: string): string | null {
  return pricesPathsFor(sourceId)[0]?.path ?? null;
}

/** Index pages: /prices, then each country and each country's categories. */
export function pricesIndexPaths(): string[] {
  const paths = ["/prices"];
  for (const g of countryGroups()) {
    paths.push(g.path);
    for (const c of g.categories) paths.push(c.path);
  }
  return paths;
}

/** Every individual answer page path (bulk and example). */
export function answerPagePaths(): string[] {
  return pageRefs().map((p) => p.path);
}

/** The newest data day behind any page (for sitemap lastmod and the /prices index). */
export function newestLibraryDay(): string | null {
  return pageRefs().reduce<string | null>((acc, p) => newest(acc, p.asOf), null);
}
