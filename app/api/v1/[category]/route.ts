// GET /api/v1/<tool>?country=..&..  One route for every category folder (fuel, home-sales, ...).
// Examples: /api/v1/fuel?country=ES&area=28&fuel=diesel · /api/v1/home-sales?country=GB&town=Bristol
import { categoryByRestPath, paramsFromQuery, runCategory } from "../../../../lib/registry";
import { json, answerResponse, errorResponse, baseUrl, corsPreflight } from "../../../../lib/route-helpers";

export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ category: string }> }) {
  const { category } = await ctx.params;
  const cat = categoryByRestPath(category);
  if (!cat) return json({ error: `Unknown endpoint /api/v1/${category}. See /api/v1/coverage.` }, 404);
  try {
    const params = paramsFromQuery(cat, new URL(req.url).searchParams);
    return answerResponse(await runCategory(cat, params, { baseUrl: baseUrl(req) }), cat.cacheSeconds ?? 600);
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
