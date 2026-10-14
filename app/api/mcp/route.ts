// The AI-agent plug (MCP server). One tool per category folder in categories/, built from the source manifests.
// Plain, factual tool descriptions with "use when / do not use" lines. No pricing, self-promotion or instructions to the model.
// The tool list, titles, annotations and output schemas live in lib/mcp-tools.ts (so tests can call every handler).

import { createProofPriceMcpHandler } from "../../../lib/mcp-tools";
import { recordUsage, usageEnabled } from "../../../lib/usage";

const mcp = createProofPriceMcpHandler();

/** Anonymous usage counting only (off unless lib/usage.ts is switched on): when a client connects (initialize) and says what app it is
 *  (clientInfo.name), that name is tallied. Nothing else from the request is read or kept. */
async function handler(req: Request): Promise<Response> {
  if (usageEnabled() && req.method === "POST") {
    try {
      const body: any = await req.clone().json();
      const msgs = Array.isArray(body) ? body : [body];
      for (const m of msgs) {
        if (m?.method === "initialize") recordUsage({ tool: "mcp_initialize", status: "ok", client: m?.params?.clientInfo?.name });
      }
    } catch {
      /* not JSON, or unreadable: nothing to count */
    }
  }
  return mcp(req);
}

export { handler as GET, handler as POST };
export const maxDuration = 60;
