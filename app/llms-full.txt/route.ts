import { buildLlmsFullTxt } from "../../lib/open-book";
import { baseUrl } from "../../lib/route-helpers";

export async function GET(req: Request) {
  return new Response(buildLlmsFullTxt(baseUrl(req)), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
