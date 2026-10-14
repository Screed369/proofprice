// Loads the answer pages from the price library once per build (or per server process) and offers the lookups the
// /prices pages, the sitemap and llms-full.txt need. The rules live in answer-pages.ts; this file only reads and groups.

import { readLatestDay, readMeta } from "../library/store";
import { SOURCE_PLUGINS, categoryById } from "../registry";
import {
  CATEGORY_LABEL,
  PAGE_SOURCES,
  buildSourcePages,
  type AnswerPage,
  type BuildResult,
  type PageCategory,
} from "./answer-pages";

export interface LoadedPages extends BuildResult {
  /** Library days that produced pages, by source id. */
  days: Record<string, string>;
}

let cache: LoadedPages | null = null;

/** Build every answer page from the newest library day of each source. Memoised: the library cannot change inside one build. */
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

export function allAnswerPages(): AnswerPage[] {
  return loadAnswerPages().pages;
}

export function findAnswerPage(countrySlug: string, category: string, areaSlug: string): AnswerPage | undefined {
  return allAnswerPages().find((p) => p.countrySlug === countrySlug && p.category === category && p.area.slug === areaSlug);
}

export interface CategoryGroup {
  category: PageCategory;
  label: string;
  path: string; // /prices/es/fuel
  sourceId: string;
  asOf: string;
  pages: AnswerPage[];
}

export interface CountryGroup {
  slug: string;
  code: string;
  name: string;
  path: string; // /prices/es
  categories: CategoryGroup[];
}

/** Pages grouped by country, then category. */
export function countryGroups(): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const p of allAnswerPages()) {
    let g = groups.get(p.countrySlug);
    if (!g) {
      g = { slug: p.countrySlug, code: p.country, name: p.countryName, path: `/prices/${p.countrySlug}`, categories: [] };
      groups.set(p.countrySlug, g);
    }
    let c = g.categories.find((x) => x.category === p.category);
    if (!c) {
      c = { category: p.category, label: CATEGORY_LABEL[p.category], path: `/prices/${p.countrySlug}/${p.category}`, sourceId: p.sourceId, asOf: p.asOf, pages: [] };
      g.categories.push(c);
    }
    c.pages.push(p);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function findCategoryGroup(countrySlug: string, category: string): { country: CountryGroup; group: CategoryGroup } | undefined {
  const country = countryGroups().find((g) => g.slug === countrySlug);
  const group = country?.categories.find((c) => c.category === category);
  return country && group ? { country, group } : undefined;
}

/** Index pages, then answer pages: every path under /prices that exists. */
export function pricesIndexPaths(): string[] {
  const paths = ["/prices"];
  for (const g of countryGroups()) {
    paths.push(g.path);
    for (const c of g.categories) paths.push(c.path);
  }
  return paths;
}

export function answerPagePaths(): string[] {
  return allAnswerPages().map((p) => p.path);
}

/** The newest library day behind any answer page (for sitemap lastmod and the /prices index). */
export function newestLibraryDay(): string | null {
  const days = Object.values(loadAnswerPages().days);
  return days.length ? days.sort().reverse()[0] : null;
}
