import { buildOpenApi } from "../../lib/openapi";
import { baseUrl } from "../../lib/route-helpers";

export async function GET(req: Request) {
  return new Response(JSON.stringify(buildOpenApi(baseUrl(req)), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
