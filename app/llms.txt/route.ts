import { buildLlmsTxt } from "../../lib/openapi";
import { baseUrl } from "../../lib/route-helpers";

export async function GET(req: Request) {
  return new Response(buildLlmsTxt(baseUrl(req)), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
