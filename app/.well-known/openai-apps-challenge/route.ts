// Domain verification for OpenAI's plugin directory: the token (and only the token) as plain text. See lib/openai-challenge.ts.
import { challengeToken } from "../../../lib/openai-challenge";

export const dynamic = "force-dynamic";

export function GET() {
  const token = challengeToken();
  if (token === null) {
    return new Response("No domain verification token is set.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(token, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
