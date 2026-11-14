// GET /api/v1/paid/<category>?country=..&..&price=..  The pay-first door (a 14-day test, owner-approved 14 Nov 2026).
// Same parameters as GET /api/v1/<category>, plus an optional price. Returns { answer, trend, check, notice } (lib/paid-lookup.ts).
// Charged from the first call (key "lookup" in lib/payments/prices.ts) ONLY when the source is on the cleared list; otherwise it is
// served free with a note, and it never returns a 402. With the payment gate off (the default) it is simply served. The free
// look-up at /api/v1/<category> is a different route and is not changed by this one.
import { categoryByRestPath } from "../../../../../lib/registry";
import { buildLookup } from "../../../../../lib/paid-lookup";
import { gatedRest } from "../../../../../lib/payments";
import { lookupSourcesFromUrl } from "../../../../../lib/premium-sources";
import { proofFor, proofHeaders } from "../../../../../lib/proofs";
import { isOwnRequest, recordUsage, statusOfAnswer, statusOfError, usageKey, visitorOf, withoutOwnParam } from "../../../../../lib/usage";
import { json, errorResponse, baseUrl, corsPreflight } from "../../../../../lib/route-helpers";

export const maxDuration = 60;

export function GET(req: Request, ctx: { params: Promise<{ category: string }> }) {
  return gatedRest("lookup", req, () => handle(req, ctx), async () => lookupSourcesFromUrl(req.url, (await ctx.params).category));
}

async function handle(req: Request, ctx: { params: Promise<{ category: string }> }) {
  const { category } = await ctx.params;
  const cat = categoryByRestPath(category);
  if (!cat) return json({ error: `Unknown endpoint /api/v1/paid/${category}. See /api/v1/coverage.` }, 404);
  const own = isOwnRequest(req);
  const q = withoutOwnParam(new URL(req.url).searchParams);
  const tool = `paid/${cat.restPath}`;
  try {
    const bundle = await buildLookup(cat, q, { baseUrl: baseUrl(req) });
    recordUsage({ tool, country: q.get("country"), key: usageKey(Object.fromEntries(q.entries())), status: statusOfAnswer(bundle.answer), own, visitor: own ? null : visitorOf(req) });
    // The signed statement of the normal answer travels with the bundle exactly as it does with the free look-up.
    const proof = await proofFor("answer", cat.tool, cat.id, bundle.answer, baseUrl(req));
    const stale = bundle.answer.extra?.stale === true;
    return json(bundle, 200, 0, { ...(stale ? { "x-proofprice-stale": `snapshot=${String(bundle.answer.extra?.snapshot_date ?? "")}` } : {}), ...proofHeaders(proof) });
  } catch (e) {
    recordUsage({ tool, country: q.get("country"), key: usageKey(Object.fromEntries(q.entries())), status: statusOfError(e), own, visitor: own ? null : visitorOf(req) });
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
