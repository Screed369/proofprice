import { pricingFacts } from "../../lib/pricing";
import { baseUrl } from "../../lib/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return new Response(JSON.stringify(pricingFacts(baseUrl(req)), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
