// GET /api/v1/check?category=rent&country=IE&town=Dublin&price=2400&unit=per%20month
// The price referee: runs the category's normal answer and compares the proposed price with it (lib/check.ts).
// Takes the category's own parameters plus price (required), currency, unit and includes.
import { CATEGORIES, paramsFromQuery, runCategory } from "../../../../lib/registry";
import { CHECK_RESERVED, CHECK_TOOL, resolveCategory, runCheck } from "../../../../lib/check";
import { isOwnRequest, recordUsage, statusOfAnswer, statusOfError, usageKey, visitorOf, withoutOwnParam } from "../../../../lib/usage";
import { gatedRest } from "../../../../lib/payments";
import { checkSourcesFromUrl } from "../../../../lib/premium-sources";
import { json, errorResponse, baseUrl, corsPreflight, STALE_CACHE_SECONDS } from "../../../../lib/route-helpers";

export const maxDuration = 60;

// Premium call: with the payment gate off (the default) this is exactly the plain handler (lib/payments/).
export function GET(req: Request) {
  return gatedRest("check", req, () => handle(req), () => checkSourcesFromUrl(req.url));
}

async function handle(req: Request) {
  try {
    const own = isOwnRequest(req); // our own checks are not counted
    const q = withoutOwnParam(new URL(req.url).searchParams);
    const cat = resolveCategory(CATEGORIES, q.get("category"));
    const rest = new URLSearchParams();
    for (const [k, v] of q.entries()) if (!CHECK_RESERVED.includes(k)) rest.append(k, v);
    const args: Record<string, unknown> = { ...paramsFromQuery(cat, rest) };
    for (const k of CHECK_RESERVED) {
      const v = q.get(k);
      if (v !== null && v !== "") args[k] = v;
    }
    let result;
    try {
      result = await runCheck(args, { categories: CATEGORIES, runCategory }, { baseUrl: baseUrl(req) });
    } catch (e) {
      recordUsage({ tool: CHECK_TOOL, country: args.country, key: usageKey(args), status: statusOfError(e), own, visitor: own ? null : visitorOf(req) });
      throw e;
    }
    recordUsage({ tool: CHECK_TOOL, country: args.country, key: usageKey(args), status: statusOfAnswer(result.answer), own, visitor: own ? null : visitorOf(req) });
    const stale = result.answer.extra?.stale === true;
    const cache = stale ? Math.min(cat.cacheSeconds ?? 600, STALE_CACHE_SECONDS) : cat.cacheSeconds ?? 600;
    return json(result, 200, cache, stale ? { "x-proofprice-stale": `snapshot=${String(result.answer.extra?.snapshot_date ?? "")}` } : {});
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
