// The light MCP address for homes and rent: /api/mcp/homes. Four tools only (pricepaid_home_sales, pricepaid_rent_prices,
// pricepaid_check_price, pricepaid_coverage), the same public names and the same handlers as /api/mcp, so an agent that only wants
// to know what homes and rent cost reads a short tool list. The main address is unchanged.

import { createProofPriceMcpHandler, HOMES_TOOLS, LIVE_DEPS, withInitializeCount } from "../../../../lib/mcp-tools";

const handler = withInitializeCount(createProofPriceMcpHandler(LIVE_DEPS, { tools: HOMES_TOOLS }));

export { handler as GET, handler as POST };
export const maxDuration = 60;
