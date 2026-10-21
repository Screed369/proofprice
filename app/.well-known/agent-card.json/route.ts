// A2A Agent Card (Agent2Agent protocol, card at /.well-known/agent-card.json): lets agent directories and other agents find
// ProofPrice from the domain alone. Honest scope: ProofPrice is a read-only price service reached over MCP and REST. It does not
// run A2A message exchange, so the card says so and points at the real endpoints. Public, no key; CORS open.
import { buildAgentCard } from "../../../lib/agent-card";

export const dynamic = "force-static";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=3600",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "Content-Type",
};

export async function GET() {
  return new Response(JSON.stringify(buildAgentCard(), null, 2), { headers: HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
