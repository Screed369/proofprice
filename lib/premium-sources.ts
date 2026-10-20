// Which source stands behind a premium call, worked out BEFORE the payment gate decides anything.
// Returns null when it cannot be worked out (bad input, unknown country): the gate then treats the call as not cleared and serves it free.
import { categoryByRestPath, CATEGORIES, pickSource, paramsFromQuery } from "./registry";
import { CHECK_RESERVED, resolveCategory, splitCheckArgs } from "./check";
import { withoutOwnParam } from "./usage";
import { normaliseCountry } from "./countries";
import type { CategoryPlugin, Params } from "./plugin";

function sourceIdOf(cat: CategoryPlugin, params: Params): string[] | null {
  try {
    const country = normaliseCountry(params.country);
    return [pickSource(cat, { ...params, country }).src.info.id];
  } catch {
    return null;
  }
}

/** Source ids behind a history call for this category and parameters. */
export function historySources(cat: CategoryPlugin, params: Params): string[] | null {
  return sourceIdOf(cat, params);
}

/** Source ids behind a price check from raw arguments (MCP arguments, or REST query pairs). */
export function checkSources(raw: Record<string, unknown>, categories: CategoryPlugin[] = CATEGORIES): string[] | null {
  try {
    const { fixed, params } = splitCheckArgs(raw);
    return sourceIdOf(resolveCategory(categories, fixed.category), params);
  } catch {
    return null;
  }
}

/** REST: sources behind GET /api/v1/check. */
export function checkSourcesFromUrl(url: string): string[] | null {
  try {
    const q = withoutOwnParam(new URL(url).searchParams);
    const cat = resolveCategory(CATEGORIES, q.get("category"));
    const rest = new URLSearchParams();
    for (const [k, v] of q.entries()) if (!CHECK_RESERVED.includes(k)) rest.append(k, v);
    return sourceIdOf(cat, paramsFromQuery(cat, rest));
  } catch {
    return null;
  }
}

/** REST: sources behind GET /api/v1/<category>/history. */
export function historySourcesFromUrl(url: string, categoryPath: string): string[] | null {
  try {
    const cat = categoryByRestPath(categoryPath);
    if (!cat) return null;
    return sourceIdOf(cat, paramsFromQuery(cat, withoutOwnParam(new URL(url).searchParams)));
  } catch {
    return null;
  }
}
