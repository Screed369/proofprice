// Site-wide constants. Kept in their own file so lib/site/* and lib/open-book.ts can both import them without a cycle.

/** The canonical public address. Used where the page cannot know the request host (robots, sitemap, JSON-LD, setup guides). */
export const SITE_URL = "https://proofprice.com";
export const MCP_URL = `${SITE_URL}/api/mcp`;
export const CONTACT = "hello@proofprice.com";
export const SITE_NAME = "ProofPrice";
/** The service version: OpenAPI info.version, MCP serverInfo.version and server.json all read it from here. */
export const SERVICE_VERSION = "0.4.0";
export const TAGLINE = "What people actually paid. Official data, for AI agents.";
/** Meta description for the home page and the site default: plain, about 160 characters. */
export const SITE_DESCRIPTION =
  "What people actually paid for homes, fuel and more, from official open data. A free MCP server and REST API for AI agents, with source and licence on every answer.";
