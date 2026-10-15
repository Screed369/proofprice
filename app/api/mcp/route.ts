// The AI-agent plug (MCP server). One tool per category folder in categories/, built from the source manifests.
// Plain, factual tool descriptions with "use when / do not use" lines. No pricing, self-promotion or instructions to the model.
// The tool list, titles, annotations and output schemas live in lib/mcp-tools.ts (so tests can call every handler).

import { createProofPriceMcpHandler, withInitializeCount } from "../../../lib/mcp-tools";

// Anonymous usage counting of connecting apps (clientInfo.name) is done on the side and never holds a request up (lib/mcp-tools.ts).
const handler = withInitializeCount(createProofPriceMcpHandler());

export { handler as GET, handler as POST };
export const maxDuration = 60;
