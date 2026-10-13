// GET /api/v1/<tool>/history?country=..&..&days=30  Daily history from the ProofPrice price library.
// Example: /api/v1/fuel/history?country=ES&area=28&fuel=diesel&days=30
import { categoryByRestPath, paramsFromQuery, runHistory } from "../../../../../lib/registry";
import { json, errorResponse, baseUrl, corsPreflight } from "../../../../../lib/route-helpers";

export async function GET(req: Request, ctx: { params: Promise<{ category: string }> }) {
  const { category } = await ctx.params;
  const cat = categoryByRestPath(category);
  if (!cat) return json({ error: `Unknown endpoint /api/v1/${category}/history. See /api/v1/coverage.` }, 404);
  if (!cat.history) return json({ error: `No daily history is kept for ${cat.restPath} yet.` }, 404);
  try {
    const params = paramsFromQuery(cat, new URL(req.url).searchParams);
    return json(runHistory(cat, params, { baseUrl: baseUrl(req) }), 200, 3600);
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
