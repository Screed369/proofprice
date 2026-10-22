// GET /api/v1/<tool>?country=..&..  One route for every category folder (fuel, home-sales, ...).
// Examples: /api/v1/fuel?country=ES&area=28&fuel=diesel · /api/v1/home-sales?country=GB&town=Bristol
import { categoryByRestPath, assertKnownParams, paramsFromQuery, runCategory } from "../../../../lib/registry";
import { json, answerResponse, errorResponse, baseUrl, corsPreflight } from "../../../../lib/route-helpers";
import { isOwnRequest, recordUsage, statusOfAnswer, statusOfError, usageKey, visitorOf, withoutOwnParam } from "../../../../lib/usage";

export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ category: string }> }) {
  const { category } = await ctx.params;
  const cat = categoryByRestPath(category);
  if (!cat) return json({ error: `Unknown endpoint /api/v1/${category}. See /api/v1/coverage.` }, 404);
  try {
    const own = isOwnRequest(req); // our own checks are not counted (nothing is stored about them)
    const params = paramsFromQuery(cat, withoutOwnParam(new URL(req.url).searchParams));
    assertKnownParams(cat, params);
    try {
      const answer = await runCategory(cat, params, { baseUrl: baseUrl(req) });
      recordUsage({ tool: cat.tool, country: params.country, key: usageKey(params), status: statusOfAnswer(answer), own, visitor: own ? null : visitorOf(req) });
      return answerResponse(answer, cat.cacheSeconds ?? 600);
    } catch (e) {
      recordUsage({ tool: cat.tool, country: params.country, key: usageKey(params), status: statusOfError(e), own, visitor: own ? null : visitorOf(req) });
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
