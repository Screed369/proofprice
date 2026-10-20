// MCP Server Card (draft spec SEP-2127): lets an MCP client or directory find the server from the domain alone.
// Same identity as server.json. Public, no key; CORS open for browser-based clients.
import { buildServerCard } from "../../../lib/open-book";
import { SERVICE_VERSION } from "../../../lib/site/constants";

export const dynamic = "force-static";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=3600",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "Content-Type",
};

export async function GET() {
  return new Response(JSON.stringify(buildServerCard(SERVICE_VERSION), null, 2), { headers: HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
